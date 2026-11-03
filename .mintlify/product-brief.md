# Product brief

## Description
AmzDownloader lets customers extract Amazon product and variant images, product videos, related videos and creator videos. Its public API and MCP tools use the existing AmzDownloader account and credit balance.

## Primary audience
Developers integrating Amazon product media into their applications and operators connecting AI agents to a bounded media extraction workflow.

## Jobs to be done
1. Create or select an API key and make a media extraction request.
2. Handle a cached response or poll one owned job until it finishes.
3. Retrieve media, preserve warnings and freshness metadata, optionally convert a supported video playlist to MP4, and inspect usage.

## Motivation
Automate the media extraction customers already perform with AmzDownloader without copying keys into browser code or implementing a separate agent integration.

## Confirmed product decisions
Public REST base: https://amzdownloader.com/api/v1. Hosted MCP: https://amzdownloader.com/mcp. Documentation: https://amzdownloader.com/docs. One credit per successful extraction or cached media retrieval, and one per successful conversion. Polling, failures and idempotent replays are free.

## Assumptions
The documentation audience prioritizes a single-product workflow before bulk automation. No bulk endpoint, OAuth or published npm package is promised by this release. Deployment availability must be verified separately from this source content.

## Visual identity
Use the dashboard palette: brand orange `#FE6320`, light orange `#FF9352`, dark ink `#160D08` for primary buttons, and white `#FFFFFF` for the light background. Keep these values aligned with the dashboard tokens in `amzdownloader-com/tailwind.config.js`.

## Tutorials and client setup
The documentation now includes complete Python image, Node.js video, and sequential multi-product workflows. Multi-product work means bounded iteration over single-product requests, not a bulk endpoint. Client guides cover Claude Code, Cursor, VS Code, and Codex using their documented HTTP MCP configuration and secret-variable mechanisms. The developer marketing pages introduce these workflows; these docs explain how to run them.

## API key lifecycle
Customer jobs belong to the account and remain accessible after key rotation. Rotation creates a replacement while the previous key remains valid for 24 hours, unless revoked sooner. Ten still-valid keys per account includes keys within this overlap.
