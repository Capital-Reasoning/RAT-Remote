# RAT Council Remote

RAT Council Remote is the public static doorway to a privately operated local
model council. The page asks only for a password. Successful authentication
reveals the hold-to-talk Council interface.

This repository intentionally contains only HTML, CSS, JavaScript, and public
connection metadata. It contains no password, password hash, bearer session,
model, prompt configuration, run history, generated audio, transcript, or
Council data.

## Security boundary

GitHub Pages serves public static files, so the page source itself is not
secret. Access control is enforced by the HTTPS gateway on the model machine:

- password verification uses a locally stored salted scrypt credential;
- successful login creates a random twelve-hour bearer held only in JavaScript
  memory;
- five failed logins within five minutes lock that client out for fifteen
  minutes;
- the gateway accepts browser requests only from the exact GitHub Pages
  origin;
- only the Council speech endpoints are proxied;
- reloading, closing, or locking the page discards the browser session.

The public Tailscale Funnel hostname is routing information, not a credential.
The gateway still requires authentication for every private Council request.
The gateway also serves this same reviewed static bundle. If browser policy
blocks GitHub Pages from reaching a local-network-classified Tailscale address,
the doorway automatically moves to that same-origin copy before login.

## Conversation flow

After login, tap the central circle to leave the microphone open. Parakeet
refreshes its partial transcript every 200 ms. Whenever the normalized final
word changes, the warm Typewriter 1938 model supersedes its previous silent
draft and begins again from the latest utterance.

Nothing speculative is displayed or spoken. A 400 ms acoustic pause commits
the turn, Parakeet produces the final transcript, and the server releases a
draft only when its transcript matches that final result. Stale drafts are
cancelled. Stable phrase prefixes then stream into five-step Supertonic 3
synthesis using the male `M5` style at native `1.0×` speed.

The experimental server-side vocoder remains bypassed. The browser combines
the phrase chunks into one growing Typewriter message while audio plays in
order. A deterministic gate can continue warranted requests through the normal
RAT Council after the immediate response. Its spoken updates are broad public
process summaries, not private chain-of-thought.

The user can tap the microphone off for a manual boundary or interrupt
playback. The current interface is turn-taking with speculative generation,
not full-duplex simultaneous speech.

The public page never uses cloud speech recognition, cloud synthesis,
analytics, third-party scripts, or browser storage.

## Deployment

GitHub Pages publishes the repository root from `main`. The private Council
Studio and authenticated Funnel gateway must be running separately on the Mac
Studio.
