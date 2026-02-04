import { memo } from 'react';
import { Server } from 'lucide-react';
import type { NodeStats } from '@/types/api';

interface NodeSelectorProps {
  nodeStats: NodeStats | null;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
}

const NodeSelector = memo<NodeSelectorProps>(({ nodeStats, selectedNodeId, onNodeSelect }) => {
  if (!nodeStats || Object.keys(nodeStats.nodes).length <= 1) {
    return null; // Don't show selector if only one node or no data
  }

  const nodes = Object.entries(nodeStats.nodes).map(([nodeId, node]) => ({
    id: nodeId,
    name: node.name
  }));

  return (
    <div className="flex items-center gap-2">
      <Server className="h-4 w-4 text-gray-500 dark:text-gray-400" />
      <select
        value={selectedNodeId || ''}
        onChange={(e) => onNodeSelect(e.target.value || null)}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      >
        <option value="">All Nodes (Cluster)</option>
        {nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.name}
          </option>
        ))}
      </select>
    </div>
  );
});

NodeSelector.displayName = 'NodeSelector';

export default NodeSelector;
