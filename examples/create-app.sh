#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# create-romatech-app — Quick scaffold for a new Express + ORM + AI app
# ---------------------------------------------------------------------------
# Usage: bash <(curl -s https://raw.githubusercontent.com/RomaTech-LTDA/ai-extensions-node/main/examples/create-app.sh) my-app
# ---------------------------------------------------------------------------

APP_NAME="${1:-my-romatech-app}"

echo "Creating $APP_NAME..."
mkdir -p "$APP_NAME/src"
cd "$APP_NAME"

# package.json
cat > package.json << 'EOF'
{
  "name": "APP_NAME_PLACEHOLDER",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@romatech/ai-extensions": "^1.0.0",
    "@romatech/orm": "^1.0.0",
    "@romatech/orm-providers-memory": "^1.0.0",
    "express": "^5.1.0",
    "reflect-metadata": "^0.2.2"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.7.0"
  }
}
EOF
sed -i "s/APP_NAME_PLACEHOLDER/$APP_NAME/" package.json

# tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}
EOF

# src/server.ts
cat > src/server.ts << 'EOF'
import 'reflect-metadata';
import express from 'express';
import { useAi, registerAiMetadata, aiTool, aiReadOnly } from '@romatech/ai-extensions';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Example endpoint
app.get('/api/hello', (_req, res) => {
  res.json({ message: 'Hello from RomaTech!' });
});

app.post('/api/echo', (req, res) => {
  res.json({ echo: req.body });
});

// AI metadata
registerAiMetadata('GET', '/api/hello', aiReadOnly({ description: 'Returns a greeting' }));
registerAiMetadata('POST', '/api/echo', aiTool({ toolName: 'echo', description: 'Echoes back the request body' }));

// Enable AI (MCP + RAG)
useAi(app, { baseUrl: `http://localhost:${PORT}` });

app.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`MCP:    http://localhost:${PORT}/mcp`);
});
EOF

echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "✓ Created $APP_NAME"
echo ""
echo "Next steps:"
echo "  cd $APP_NAME"
echo "  npm run dev"
echo ""
echo "Then test MCP:"
echo "  curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'"
