# Security

Static client-side app: no backend, no accounts, no external requests at runtime (fonts are bundled).
Inputs from the URL and localStorage are validated (`sanitize*`); the production build ships a strict CSP.

Report a vulnerability through GitHub's private vulnerability reporting (Security tab → Report a vulnerability).
