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

## Conversation flow

After login, hold the central circle while speaking and release it to send.
Parakeet transcribes locally, Talkie answers immediately through Chatterbox
Turbo MLX, and GPT-OSS decides whether the utterance warrants the full Council.
Deeper turns receive concise spoken stage updates and finish with the normal
pipeline's Talkie output verbatim.

Parakeet's acoustic alignment supplies word start/end milliseconds to the
immediate Talkie prompt. A local timing planner distinguishes a clear handoff
from an unfinished or reflective turn and supplies the desired reply gap. The
user can barge in on Talkie; the hold gesture remains an explicit user turn
boundary rather than pretending to provide full-duplex model interruption.

The public page never uses cloud speech recognition, cloud synthesis,
analytics, third-party scripts, or browser storage.

## Deployment

GitHub Pages publishes the repository root from `main`. The private Council
Studio and authenticated Funnel gateway must be running separately on the Mac
Studio.
