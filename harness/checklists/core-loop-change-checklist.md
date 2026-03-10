# Core Loop Change Checklist

Use this when the change touches Ask, Program creation, Brief generation, correction handling, recurring follow-through, or trust visibility in the main loop.

- [ ] The change still supports Ask -> Program -> Brief -> Correction or Action -> Next brief improves.
- [ ] Program continuity remains intact across sessions or recurring runs.
- [ ] Brief output still includes recommendation, what changed, evidence, memory assumptions, and next actions.
- [ ] A correction can change the next brief rather than just the current chat response.
- [ ] Provenance is visible somewhere in the recommendation path, not only in backend state.
- [ ] Internal execution details do not leak into the main user-facing flow by default.
- [ ] Degraded mode is still coherent when optional browser or sandbox services are unavailable.
- [ ] Validation evidence names the scenario or user path used to check the loop.
