# RAT Remote

RAT Remote is the static browser interface for a privately operated RAT planning and voice engine.

This public repository intentionally contains only the HTML, CSS, and JavaScript needed to render the interface. It contains no backend source, model configuration, provider credentials, password material, project documents, project bundles, private hostnames, private IP addresses, or history from the private engine repository.

## Security boundary

The public page is not the security boundary. The local gateway is responsible for authentication, authorization, rate limiting, HTTPS, CORS, and storage. RAT Remote sends a password only to the user-entered HTTPS gateway and keeps the returned session bearer in JavaScript memory. It does not accept credentials in URL parameters and does not persist the gateway URL, session bearer, or active project identifier in browser storage.

The page has no third-party scripts, analytics, fonts, images, package dependencies, service worker, or public backend. Project documents and audio travel directly between the browser and the authenticated gateway selected by the user.

## Communication modes

Input and output are independent. Input can be **Type** or **Talk**. Output can be **Voice on** or **Voice muted**, and response text is always displayed. Typed audible responses are synthesized by the authenticated local gateway using the project's selected RAT voice; the public page does not use a cloud or browser speech provider.

Never commit credentials, endpoint inventories, project exports, or user documents to this repository.

## Files intentionally published

- `index.html`
- `styles.css`
- `app.js`
- `planner.js`
- `.nojekyll`
- `README.md`
- `SECURITY.md`
- `LICENSE`

## Deployment

GitHub Pages publishes the repository root from the `main` branch. The local RAT engine must be running separately behind an HTTPS endpoint that permits this Pages origin.
