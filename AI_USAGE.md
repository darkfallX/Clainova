# AI usage

The builder supplied the product concept, chose the Clainova name, described the intended organiser and recipient, and requested an end-to-end hackathon build. They selected local delivery when the live workflow required external access.

OpenAI Codex researched the event and its public projects, checked wallet and cryptographic interfaces, designed the printed payment slip, wrote the application, escrow, tests and documentation, and ran the build, browser journey and read-only Diana probe. It also recorded the rehearsal using the implemented interface.

Three decisions changed the implementation. The public gallery count was rechecked. The verifier's invitation secret was separated from the public escrow identifier. The browser-created wallet uses QoreSign to open a target-limited window because several documented QoreX interfaces restrict page-initiated window requests. The browser suite exercises the encrypted backup and the contract suite covers destination and domain binding.

The builder funded the dedicated Diana deployment account. Codex used it to register the post-quantum key, open a one-transaction window and deploy the escrow, then checked the token address and verifier key on chain. [Deployment receipts](submission/diana-deployment.json)

The builder set up the Africa’s Talking sandbox and simulator number. Codex sent a test message through the sandbox API and the builder confirmed it appeared in the simulator inbox. Human security review, two-stage QCAI auditing, handset delivery and a live recipient claim are still pending.

The GitHub import groups the completed local build (5eb6f52) into commits by feature. Their dates reflect publication.

On 24 November the builder asked Claude Code (Anthropic, Claude Opus 5.5) to review submission readiness and polish the interface. Claude ran the app end to end in a browser at phone and desktop widths and listed the remaining gaps. It then merged the two stacked stylesheets into a single Pocket Fold theme and added the motion pass described in [Design decisions](docs/design-direction.md). That pass covers the sealing envelope, the collection stamp, the recipient step rail, the issued timeline and the ledger funnel. Claude also fixed the issues it found while testing: `localhost` returned a raw 403, the main wallet action used secondary styling, long addresses wrapped, and the issued page repeated its details. It reran the unit, contract and browser suites. Later the same day, Claude wrote an AI security review, which is not a human review. It also fixed rate limiting behind a tunnel. It ran QCAI round 1 in the builder's signed-in browser, and the builder confirmed each audit dialog. Claude assessed each finding against the code, added a reentrancy guard and checked token calls with new tests, and redeployed v2 with the existing deployer. The builder approved the plan before any changes were made.

The builder chose Pocket Fold from ten original UI concepts. Codex used the built-in ImageGen tool to extract a standalone ultramarine paper envelope with an orange folded corner from the selected concept, then packaged a WebP version for the counter. Receipt text, status and form controls are rendered by the application. [Concepts and prompts](docs/visual-concepts/README.md)
