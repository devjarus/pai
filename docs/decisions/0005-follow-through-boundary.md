# 0005 Follow-Through Boundary

## Decision

Treat `Action` as the internal primitive for tracked follow-through, but present it to users as optional follow-through or recommended moves rather than as a primary standalone todo product.

## Why

Real usage showed three failures:

- generic Program-created actions often just restated the Program
- the standalone `/tasks` surface felt like a generic task manager
- duplicate linked follow-through weakened trust instead of improving continuity

The core product is still Program -> Brief -> better next brief. Follow-through only helps when it captures a real manual move worth revisiting.

## Tradeoff

- the product uses different language at different layers: internal `Action`, user-facing `recommended move` or `follow-through`
- the standalone list becomes secondary rather than a co-equal surface
- not every brief recommendation becomes a tracked item

Those tradeoffs reduce noun drift and keep the loop focused on decision continuity instead of backlog management.

## Implications

- Briefs should present `recommended moves` inline
- Programs should only track manual steps the user wants revisited
- `/tasks` should behave as a source-aware follow-through list, not a generic todo manager
- duplicate open linked follow-through for the same Program or Brief should be suppressed
- internal system-improvement work should not surface as user-facing follow-through
