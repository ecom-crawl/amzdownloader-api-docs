# AmzDownloader API documentation

Public Mintlify documentation source for [amzdownloader.com/docs](https://amzdownloader.com/docs). REST base: `https://amzdownloader.com/api/v1`; hosted MCP: `https://amzdownloader.com/mcp`.

This repository contains the public contract and customer guides. It does not contain service credentials or the private service implementation. Source publication alone does not establish service availability.

## Develop

```bash
npm test
mint validate
mint broken-links
mint dev --port 3333 --no-open
```

`openapi.json` is a snapshot of the canonical public contract. After the API has been deployed, `npm run check:live` checks that the hosted contract matches the reviewed snapshot. Review a diff before replacing it.

## Contents

`docs.json` defines navigation and branding. API reference pages are generated from `openapi.json`. Guides cover authentication, extraction, freshness, conversion, billing, errors and MCP.

[Examples](https://github.com/ecom-crawl/amzdownloader-api-examples) · [MCP](https://github.com/ecom-crawl/amzdownloader-mcp) · [Agent skills](https://github.com/ecom-crawl/amzdownloader-agent-skills) · [MIT](LICENSE)
