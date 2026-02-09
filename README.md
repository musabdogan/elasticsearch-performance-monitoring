# Elasticsearch Performance Monitoring - Chrome Extension

Real-time performance monitoring dashboard for Elasticsearch clusters. Track indexing/search rates, latencies, index statistics, and cluster performance metrics with interactive charts.
<img width="1280" height="800" alt="performance (4)" src="https://github.com/user-attachments/assets/51368795-c0ca-49e4-9534-3f5ca5d0009e" />



## 🚀 Install from Chrome Web Store

**[Install Elasticsearch Performance Monitoring](https://chromewebstore.google.com/detail/jdljadeddpdnfndepcdegkeoejjalegm?utm_source=item-share-cb)**

## Features

- **Real-time Performance Monitoring**: Live tracking of indexing/search rates and latencies
- **Interactive Charts**: Visual performance trends with sparkline charts
- **Advanced Search & Filtering**: Search indices by name, nodes by name/IP/role
- **Index Statistics**: Comprehensive index information (shards, size, document count, shard size)
- **Node Statistics**: Detailed node performance metrics with role information
- **Multi-Cluster Support**: Manage multiple Elasticsearch clusters with easy switching
- **Cluster Resource Monitoring**: CPU usage, JVM heap, and storage utilization
- **Cluster Overview**: Real-time cluster health and node information
- **Performance Metrics**:
  - Indexing Rate (ops/sec)
  - Search Rate (ops/sec)
  - Index Latency (ms/op with auto unit conversion)
  - Search Latency (ms/op with auto unit conversion)
- **Smart Data Management**: Automatic data retention and request cancellation
- **Dark/Light Mode**: Toggle between light and dark themes
- **Direct Connection**: Connects directly to Elasticsearch clusters (no proxy needed)
- **Professional UI**: Modern, responsive design with comprehensive error handling

## Installation

### Chrome Web Store (Recommended)

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/jdljadeddpdnfndepcdegkeoejjalegm?utm_source=item-share-cb) - no build required!

### Development Mode

1. Clone this repository:
```bash
git clone https://github.com/musabdogan/elasticsearch-performance-monitoring.git
cd elasticsearch-performance-monitoring
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

- **React 18** + TypeScript (with strict mode)
- **Vite** (build tool and development server)
- **Tailwind CSS** (utility-first styling)
- **Recharts** (data visualization and sparkline charts)
- **Lucide React** (modern icon library)
- **Chrome Storage API** (secure local data persistence)
- **Elasticsearch Management APIs** (optimized with filter_path for performance)

## Performance Metrics

The extension tracks these key Elasticsearch performance indicators:

### Core Performance Metrics
- **Indexing Rate**: Operations per second for index requests
- **Search Rate**: Operations per second for search requests
- **Index Latency**: Average time per indexing operation (auto-converts ms to seconds)
- **Search Latency**: Average time per search operation (auto-converts ms to seconds)

### Cluster Resource Metrics
- **CPU Usage**: Average CPU utilization across cluster nodes
- **JVM Heap Usage**: Average JVM heap utilization across cluster nodes
- **Storage Usage**: Total cluster storage utilization with used/total breakdown

### Index & Node Analytics
- **Index Statistics**: Per-index metrics including shard size, document count, and performance
- **Node Statistics**: Per-node performance with role identification and IP information
- **Search & Filtering**: Real-time search across indices and nodes

All metrics are calculated using real-time data from optimized Elasticsearch Management APIs with automatic data retention and request cancellation for optimal performance.

## Permissions

The extension requires the following permissions:

- `storage`: To save cluster configurations locally
- `<all_urls>`: To connect to any Elasticsearch cluster URL

## Notes

- Credentials are stored locally in Chrome storage
- All API calls are made directly from the browser (CORS handled by Chrome extension permissions)

## License

MIT

