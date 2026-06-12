import { Joyride, ACTIONS, EVENTS, PORTAL_ELEMENT_ID, STATUS, type Step, type EventData } from 'react-joyride';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMonitoring } from '@/context/MonitoringProvider';

const COMPLETED_KEY = 'onboarding:getting-started:completed';
const DISMISSED_KEY = 'onboarding:getting-started:dismissed';
const STEP_LOCALE = {
  back: 'Back',
  close: 'Close',
  last: 'Done',
  next: 'Next',
  skip: 'Skip'
} as const;

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function isFirstVisit(): boolean {
  return safeLocalStorageGet(COMPLETED_KEY) !== '1' && safeLocalStorageGet(DISMISSED_KEY) !== '1';
}

export function GettingStartedTour() {
  const { clusters } = useMonitoring();
  const targetRetryRef = useRef<Record<number, number>>({});
  const stuckCheckRef = useRef<number | null>(null);
  const stepIndexRef = useRef(0);
  const runRef = useRef(false);
  const prevClusterCountRef = useRef<number>(clusters.length);

  // Step indices (keep in sync with steps list)
  const STEP_INDEX_ADD_CLUSTER = 0;
  const STEP_INDEX_CLUSTER_ADD_BUTTON = 1;
  const STEP_INDEX_CLUSTER_FORM = 2;

  const waitForSelector = (selector: string, timeoutMs = 4000): Promise<void> => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (document.querySelector(selector)) return resolve();
        if (Date.now() - start >= timeoutMs) return reject(new Error(`Timeout waiting for ${selector}`));
        setTimeout(tick, 120);
      };
      tick();
    });
  };

  const waitForAnySelector = (selectors: string[], timeoutMs = 4000): Promise<string> => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const hit = selectors.find((s) => Boolean(document.querySelector(s)));
        if (hit) return resolve(hit);
        if (Date.now() - start >= timeoutMs) return reject(new Error(`Timeout waiting for any: ${selectors.join(', ')}`));
        setTimeout(tick, 120);
      };
      tick();
    });
  };

  const steps = useMemo<Step[]>(
    () => [
      {
        target: '[data-tour="add-cluster"]',
        title: 'Add your first cluster',
        content: 'Click here to open the cluster setup.',
        placement: 'bottom',
        skipBeacon: true,
        // No Next here: clicking the button advances automatically.
        buttons: ['skip', 'back'],
        locale: STEP_LOCALE
      },
      {
        target: '[data-tour="cluster-add-button"]',
        title: 'Create a cluster entry',
        content: 'In the cluster dropdown, click “Add cluster” to open the form.',
        placement: 'bottom',
        skipBeacon: true,
        buttons: ['skip', 'back', 'primary'],
        locale: STEP_LOCALE,
        before: async () => {
          window.dispatchEvent(new CustomEvent('openClusterSelector'));
          await waitForSelector('[data-tour="cluster-add-button"]', 5000);
        }
      },
      {
        target: '[data-tour="cluster-form"]',
        title: 'Fill in connection details',
        content: 'Enter the URL and authentication details, then click “Add Cluster”.',
        placement: 'bottom',
        skipBeacon: true,
        // No Next here: clicking "Add Cluster" advances the tour.
        buttons: ['skip', 'back'],
        locale: STEP_LOCALE,
        before: async () => {
          window.dispatchEvent(new CustomEvent('openClusterSelector'));
          await waitForSelector('[data-tour="cluster-form"]', 5000);
        }
      },
      {
        target: '[data-tour="cluster-selector"]',
        title: 'Select the active cluster',
        content: 'Use the cluster selector to switch between environments and load live metrics.',
        placement: 'bottom',
        skipBeacon: true,
        buttons: ['skip', 'back', 'primary'],
        locale: STEP_LOCALE
      },
      {
        target: '[data-tour="tab-snapshots"]',
        title: 'Check snapshots',
        content: 'Use the Snapshots tab to review backup status and drill into shard-level details.',
        placement: 'bottom',
        skipBeacon: true,
        buttons: ['skip', 'back', 'primary'],
        locale: STEP_LOCALE
      },
      {
        target: '[data-tour="refresh"]',
        title: 'Refresh data',
        content: 'Use Refresh to fetch the latest data for the current tab (auto-refresh runs on Indexing & Search).',
        placement: 'bottom',
        skipBeacon: true,
        buttons: ['skip', 'back', 'primary'],
        locale: STEP_LOCALE
      },
      {
        target: 'body',
        title: 'You’re all set',
        content:
          'Your cluster is connected. Use the tabs to explore metrics (Cluster, Nodes, Indices, Snapshots) and use Refresh to re-fetch data anytime.',
        placement: 'center',
        skipBeacon: true,
        // Final step: show only a single completion action.
        buttons: ['primary'],
        locale: {
          ...STEP_LOCALE,
          last: 'Completed'
        }
      }
    ],
    []
  );

  const finalStepIndex = useMemo(() => Math.max(0, steps.length - 1), [steps.length]);

  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    runRef.current = run;
    window.dispatchEvent(new CustomEvent('onboardingTourRunChanged', { detail: { run } }));
  }, [run]);

  const stopTour = (markDismissed: boolean) => {
    if (markDismissed) safeLocalStorageSet(DISMISSED_KEY, '1');
    setRun(false);
    // Fail-safe cleanup: remove Joyride portal if it gets stuck in DOM.
    const portal = document.getElementById(PORTAL_ELEMENT_ID);
    if (portal && portal.parentElement) {
      portal.parentElement.removeChild(portal);
    }
  };

  const currentTargetSelector = useMemo(() => {
    const step = steps[stepIndex] as Step | undefined;
    return typeof step?.target === 'string' ? step.target : null;
  }, [steps, stepIndex]);

  useEffect(() => {
    // Auto-start only for first-time users AND only when no clusters exist yet.
    if (!isFirstVisit()) return;
    if (clusters.length > 0) return;
    targetRetryRef.current = {};
    setRun(true);
    setStepIndex(0);
  }, [clusters.length]);

  useEffect(() => {
    const start = () => {
      targetRetryRef.current = {};
      setStepIndex(0);
      setRun(true);
    };
    window.addEventListener('startGettingStartedTour', start as EventListener);
    return () => window.removeEventListener('startGettingStartedTour', start as EventListener);
  }, []);

  useEffect(() => {
    stepIndexRef.current = stepIndex;
  }, [stepIndex]);

  useEffect(() => {
    // If a cluster gets added while we're on the form step, advance immediately to the next stable step.
    if (!runRef.current) {
      prevClusterCountRef.current = clusters.length;
      return;
    }
    const prev = prevClusterCountRef.current;
    const curr = clusters.length;
    prevClusterCountRef.current = curr;
    if (prev === 0 && curr > 0 && stepIndexRef.current === STEP_INDEX_CLUSTER_FORM) {
      targetRetryRef.current = {};
      // Cluster is now added: show a final full-screen info step, then complete.
      setStepIndex(finalStepIndex);
    }
  }, [clusters.length, finalStepIndex]);

  useEffect(() => {
    // When user clicks "Add Elasticsearch Cluster" on Home, the app dispatches `openClusterSelector`.
    // Advance the tour automatically so the user doesn't have to click Next.
    const onOpenClusterSelector = () => {
      // Do NOT start the tour from this event. Only advance if the tour is already running.
      if (!runRef.current) return;
      // Only auto-advance from the "Add your first cluster" step.
      if (stepIndexRef.current !== STEP_INDEX_ADD_CLUSTER) return;

      // The dropdown may show the form directly (when there are no clusters), or show an "Add cluster" button (when clusters exist).
      waitForAnySelector(['[data-tour="cluster-form"]', '[data-tour="cluster-add-button"]'], 5000)
        .then((hit) => {
          if (hit.includes('cluster-form')) {
            setStepIndex(STEP_INDEX_CLUSTER_FORM);
          } else {
            setStepIndex(STEP_INDEX_CLUSTER_ADD_BUTTON);
          }
        })
        .catch(() => {
          // If we cannot reach the next step reliably, end the tour to avoid blocking UI.
          stopTour(true);
        });
    };
    window.addEventListener('openClusterSelector', onOpenClusterSelector as EventListener);
    return () => window.removeEventListener('openClusterSelector', onOpenClusterSelector as EventListener);
  }, []);

  useEffect(() => {
    if (!run) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopTour(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run]);

  useEffect(() => {
    if (!run) return;
    // Health check: if the current step target can't be reached after a short grace period,
    // end the tour so the UI never remains blocked by the overlay.
    if (stuckCheckRef.current != null) {
      window.clearTimeout(stuckCheckRef.current);
      stuckCheckRef.current = null;
    }

    const selector = currentTargetSelector;
    if (!selector) return;

    stuckCheckRef.current = window.setTimeout(() => {
      const exists = Boolean(document.querySelector(selector));
      if (exists) return;

      // For dynamic steps, rely on TARGET_NOT_FOUND retry logic before killing the tour.
      const attempt = targetRetryRef.current[stepIndex] ?? 0;
      const isDynamicStep = stepIndex === STEP_INDEX_CLUSTER_ADD_BUTTON || stepIndex === STEP_INDEX_CLUSTER_FORM;
      if (isDynamicStep && attempt < 6) return;

      stopTour(true);
    }, 4000);

    return () => {
      if (stuckCheckRef.current != null) {
        window.clearTimeout(stuckCheckRef.current);
        stuckCheckRef.current = null;
      }
    };
  }, [run, stepIndex, currentTargetSelector]);

  useEffect(() => {
    if (!run) return;
    if (stepIndex >= steps.length) stopTour(true);
  }, [run, stepIndex, steps.length]);

  const callback = (data: EventData) => {
    const { action, index, status, type } = data;

    if (type === EVENTS.STEP_AFTER) {
      // Guard: don't allow leaving the form step until at least one cluster exists.
      if (index === STEP_INDEX_CLUSTER_FORM && action !== ACTIONS.PREV && clusters.length === 0) {
        setStepIndex(STEP_INDEX_CLUSTER_FORM);
        return;
      }
      const next = action === ACTIONS.PREV ? Math.max(0, index - 1) : index + 1;
      setStepIndex(next);
      return;
    }

    if (type === EVENTS.TARGET_NOT_FOUND) {
      // Retry a few times for dynamic targets (dropdown / form) before skipping.
      const attempt = targetRetryRef.current[index] ?? 0;
      const shouldRetry = index === STEP_INDEX_CLUSTER_ADD_BUTTON || index === STEP_INDEX_CLUSTER_FORM;
      if (shouldRetry && attempt < 6) {
        targetRetryRef.current[index] = attempt + 1;
        // Re-dispatch openClusterSelector to ensure the dropdown is open.
        window.dispatchEvent(new CustomEvent('openClusterSelector'));
        setTimeout(() => setStepIndex(index), 250);
        return;
      }
      // If we still can't find the target, end the tour to avoid blocking the UI.
      stopTour(true);
      return;
    }

    if (type === EVENTS.ERROR) {
      stopTour(true);
      return;
    }

    if (status === STATUS.FINISHED) {
      safeLocalStorageSet(COMPLETED_KEY, '1');
      stopTour(false);
      return;
    }

    if (status === STATUS.SKIPPED) {
      stopTour(true);
    }
  };

  if (!run) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      continuous
      scrollToFirstStep
      onEvent={callback}
      options={{
        // Avoid accidental advances that can close dropdowns / interrupt form filling.
        overlayClickAction: false,
        dismissKeyAction: 'close',
        overlayColor: 'rgba(0, 0, 0, 0.55)',
        primaryColor: '#1b2554',
        backgroundColor: '#ffffff',
        textColor: '#111827',
        arrowColor: '#ffffff',
        zIndex: 10000
      }}
    />
  );
}

