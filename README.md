# Elasticsearch Performance Monitoring - Chrome Extension

Real-time performance monitoring dashboard for Elasticsearch clusters. Track indexing/search rates, latencies, index statistics, and cluster performance metrics with interactive charts.

<img width="1280" height="800" alt="image" src="https://github.com/user-attachments/assets/763f4f65-8c03-4b30-b04e-e89dad3eebd0" />


## 🚀 Install from Chrome Web Store

**[Install Elasticsearch Upgrade Monitoring](https://chromewebstore.google.com/detail/jdljadeddpdnfndepcdegkeoejjalegm?utm_source=item-share-cb)**

## Features

- **Real-time Performance Monitoring**: Live tracking of indexing/search rates and latencies
- **Interactive Charts**: Visual performance trends with sparkline charts
- **Index Statistics**: Comprehensive index information (shards, size, document count)
- **Multi-Cluster Support**: Manage multiple Elasticsearch clusters with easy switching
- **Cluster Overview**: Cluster health and node information
- **Performance Metrics**:
  - Indexing Rate (ops/sec)
  - Search Rate (ops/sec)
  - Index Latency (ms/op)
  - Search Latency (ms/op)
- **Dark/Light Mode**: Toggle between light and dark themes
- **Direct Connection**: Connects directly to Elasticsearch clusters (no proxy needed)

## Installation

### Chrome Web Store (Recommended)

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/jdljadeddpdnfndepcdegkeoejjalegm?utm_source=item-share-cb) - no build required!

### Development Mode

1. Clone this repository:
```bash
git clone https://github.com/musabdogan/elasticsearch-upgrade-monitoring.git
cd elasticsearch-upgrade-monitoring
```

2. Install dependencies:
```bash
npm install
```

3. Build the extension:
```bash
npm run build
```

4. Load in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` folder

### Usage

1. Click the extension icon in Chrome toolbar
2. A new tab will open with the monitoring dashboard
3. Add your first Elasticsearch cluster:
   - Click on the cluster selector
   - Enter cluster details (URL, credentials if needed)
   - Click "Add Cluster"

## Development

```bash
# Install dependencies
npm install

# Start development server (for local testing)
npm run dev

# Build for production
npm run build

# Generate placeholder icons
node scripts/create-png-icons.js
```

## Project Structure

```
elasticsearch-performance-monitoring/
├── dist/                  # Built extension (load this in Chrome)
├── public/
│   ├── manifest.json      # Chrome extension manifest
│   ├── background.js      # Service worker
│   └── icons/             # Extension icons
├── src/
│   ├── App.tsx           # Main dashboard component
│   ├── main.tsx          # Entry point
│   ├── components/       # UI components
│   │   ├── charts/       # Performance chart components
│   │   ├── data/         # Data table components
│   │   ├── layout/       # Layout components
│   │   └── feedback/     # Error/success components
│   ├── context/          # React context providers
│   ├── services/         # Elasticsearch API service
│   ├── types/            # TypeScript types
│   └── utils/            # Utility functions
├── package.json
└── vite.config.ts
```

## Tech Stack

- **React 18** + TypeScript
- **Vite** (build tool)
- **Tailwind CSS** (styling)
- **Recharts** (data visualization)
- **Lucide React** (icons)
- **Chrome Storage API** (data persistence)

## Performance Metrics

The extension tracks these key Elasticsearch performance indicators:

- **Indexing Rate**: Operations per second for index requests
- **Search Rate**: Operations per second for search requests
- **Index Latency**: Average time per indexing operation (ms)
- **Search Latency**: Average time per search operation (ms)

All metrics are calculated using real-time data from Elasticsearch's `_nodes/stats` API and displayed with interactive charts showing trends over the last 10 minutes.

## Permissions

The extension requires the following permissions:

- `storage`: To save cluster configurations locally
- `<all_urls>`: To connect to any Elasticsearch cluster URL

## Notes

- Credentials are stored locally in Chrome storage
- All API calls are made directly from the browser (CORS handled by Chrome extension permissions)

## License

MIT

