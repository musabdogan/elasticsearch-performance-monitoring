# Elasticsearch Upgrade Monitoring - Chrome Extension

Real-time monitoring dashboard for Elasticsearch cluster upgrades. Track node versions, shard recovery status, disk allocation, cluster health, and get upgrade order recommendations.

## Features

- **Real-time Monitoring**: Live polling of cluster status, node versions, shard recovery, and allocation
- **Multi-Cluster Support**: Manage multiple Elasticsearch clusters with easy switching
- **Upgrade Order Calculation**: Automatic calculation of node upgrade order based on Elasticsearch best practices
- **Shard Recovery Tracking**: Monitor active shard recovery operations with detailed progress
- **Cluster Health Dashboard**: Visual indicators for cluster status (GREEN/YELLOW/RED)
- **Ready-to-Use Commands**: Quick access to common cluster management operations
  - Flush cluster
  - Disable/Enable shard allocation
  - Disable/Enable shard rebalance
- **Dark/Light Mode**: Toggle between light and dark themes
- **Direct Connection**: Connects directly to Elasticsearch clusters (no proxy needed)

## Installation

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
elasticsearch-upgrade-monitoring/
├── dist/                  # Built extension (load this in Chrome)
├── public/
│   ├── manifest.json      # Chrome extension manifest
│   ├── background.js      # Service worker
│   └── icons/             # Extension icons
├── src/
│   ├── App.tsx           # Main dashboard component
│   ├── main.tsx          # Entry point
│   ├── components/       # UI components
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
- **Lucide React** (icons)
- **Chrome Storage API** (data persistence)

## Permissions

The extension requires the following permissions:

- `storage`: To save cluster configurations locally
- `<all_urls>`: To connect to any Elasticsearch cluster URL

## Notes

- Credentials are stored locally in Chrome storage
- All API calls are made directly from the browser (CORS handled by Chrome extension permissions)
- Icons are placeholders - replace with proper icons for production

## License

MIT

