# RAT Remote

RAT Remote is the static browser interface for a privately operated RAT planning and voice engine.

This public repository intentionally contains only the HTML, CSS, and JavaScript needed to render the interface. It contains no backend source, model configuration, provider credentials, password material, project documents, project bundles, private hostnames, private IP addresses, or history from the private engine repository.

## Security boundary

The public page is not the security boundary. The local gateway is responsible for authentication, authorization, rate limiting, HTTPS, CORS, and storage. RAT Remote sends a password only to the user-entered HTTPS gateway and keeps the returned session bearer in JavaScript memory. It does not accept credentials in URL parameters and does not persist the gateway URL, session bearer, or active project identifier in browser storage.

The page has no third-party scripts, analytics, fonts, images, package dependencies, service worker, or public backend. Project documents and audio travel directly between the browser and the authenticated gateway selected by the user.

## Conversation flow

Endpoint and password are the entire visible setup. After authentication, RAT selects the most recent local project (or creates a `Voice conversation`) and reduces to one live waveform. Hold the waveform to open the microphone; releasing it closes the microphone and submits the utterance. Pressing `/` while the waveform is focused reveals text input only when needed.

Completed utterances go directly to the authenticated gateway over HTTPS. A small local mull model first reflects the tail of the utterance while the planning model selects one high-value Socratic question. The main answer follows in the selected local RAT voice. Response text remains in an assistive live region rather than a permanent transcript panel. The public page does not use a cloud or browser speech provider.

Never commit credentials, endpoint inventories, project exports, or user documents to this repository.

## Files intentionally published

- `index.html`
- `styles.css`
- `app.js`
- `.nojekyll`
- `README.md`
- `SECURITY.md`
- `LICENSE`

## Deployment

GitHub Pages publishes the repository root from the `main` branch. The local RAT engine must be running separately behind an HTTPS endpoint that permits this Pages origin.
