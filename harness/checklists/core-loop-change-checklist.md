# Core Loop Change Checklist

Use this when the change touches Ask, Watch creation, Digest generation, correction handling, recurring follow-through, or trust visibility in the main loop.

- [ ] The change still supports Ask -> Watch creation -> Digest -> Correction or To-Do -> Next digest improves.
- [ ] Watch continuity remains intact across sessions or recurring runs.
- [ ] Digest output still includes recommendation, what changed, sources, memory assumptions, and next actions.
- [ ] A correction can change the next digest rather than just the current chat response.
- [ ] Provenance is visible somewhere in the recommendation path, not only in backend state.
- [ ] Internal execution details do not leak into the main user-facing flow by default.
- [ ] Degraded mode is still coherent when optional browser or sandbox services are unavailable.
- [ ] Validation evidence names the scenario or user path used to check the loop.
