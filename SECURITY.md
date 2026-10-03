# Security policy

## Supported deployment model

UP (Ur Private) Bookshelf is designed for a trusted home network or private tailnet. It intentionally does not require authentication. Do not expose the application port directly to the public internet.

Keep the Docker image and host operating system updated, restrict access with your network or VPN controls, and regularly back up the persistent `/data` directory.

The server rejects cross-origin browser API requests, constrains OCR uploads and processing, and allows cover downloads only from approved providers with validated redirects. These controls do not provide authentication or prevent access by someone already on your trusted network. Provider credentials are stored in SQLite and included in complete database backups; JSON and Excel book exports omit them.

## Reporting a vulnerability

Please do not publish exploitable vulnerability details in a public issue. Use GitHub's private vulnerability reporting feature for this repository when it is available. Include the affected version, reproduction steps, and the potential impact.

This project is maintained on a best-effort basis. There is no guaranteed response or remediation timeline.
