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

After login, hold the central circle while speaking and release it to send.
The captured waveform immediately seeds a quiet, nonverbal Web Audio
soundscape. It fades before Talkie answers through Chatterbox Turbo MLX.
Parakeet transcribes locally while GPT-OSS decides whether the utterance
warrants the full Council. Deeper turns receive concise spoken stage updates
and finish with the normal pipeline's Talkie output verbatim.

GPT-OSS also chooses a constrained chord and same-key progression from the
conversational tone. Generated Chatterbox speech uses the 18-band chord vocoder
fully wet. The selected chord is used for responses of five words or fewer;
longer replies move through the progression at punctuation-weighted phrase
boundaries. The selected harmony is shown beside the immediate response.

GPT-OSS supplies a grounded reply brief, then Talkie renders it after GPT-OSS
releases Metal execution. A deterministic supervisor keeps Talkie's candidate
only when it preserves the brief, speaker roles, clarification needs, supported
numbers, and scope.
Otherwise the interface transparently labels and speaks the OSS-supervised
wording.

The public conversation frames that work in Talkie's first person: “Let me
consider that more deeply,” followed by broad summaries at stage changes and
periodically during long stages. These summaries report public process state;
they do not expose or claim a private chain-of-thought.

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
