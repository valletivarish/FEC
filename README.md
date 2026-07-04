# H9FECC — Fog & Edge Computing

Fifteen independent fog/edge IoT projects for the H9FECC (Fog and Edge Computing) CA. Each project
simulates 10 sensor types feeding 3 virtual fog nodes, which process and dispatch data to a scalable
AWS backend with a live dashboard. Local development runs against [floci](https://floci.io/), a free
local AWS emulator; deployment targets real AWS with no code changes, only a config swap.

## Local development

```
cp .env.example .env
make localstack-up
```

Each project folder has its own README with project-specific setup once LocalStack is running.

## Projects

| # | Project | Domain | Language | Status |
|---|---|---|---|---|
| 1 | [ChainFrost](01-chainfrost-cold-chain/) | Cold-chain refrigerated trucking | Java | Built & tested locally |
| 2 | [CampusPulse](02-campuspulse-smart-campus/) | Smart-campus building operations | Node.js | Built & tested locally |
| 3 | [AeroSense](03-aerosense-air-quality/) | Indoor air quality & ventilation | Python | Built & tested locally |
| 4 | [GridPulse](04-gridpulse-ev-transformer/) | EV charging load-balancing & transformer protection | Node.js | Built & tested locally |
| 5 | [AquaSentinel](05-aquasentinel-fish-farm-water-quality/) | Fish-farm water-quality monitoring | Python | Built & tested locally |
| 6 | [GreengrassGuard](06-greengrassguard-predictive-maintenance/) | Predictive maintenance via vibration | Python | Built & tested locally |
| 7 | [GreenGrid](07-greengrid-microclimate/) | Outdoor campus microclimate monitoring | Python | Built & tested locally |
| 8 | [OfficeIQ](08-officeiq-smart-office-comfort/) | Smart-office occupancy & comfort | Node.js | Built & tested locally |
| 9 | [FloodWatch](09-floodwatch-river-early-warning/) | River flood early-warning | Java | Built & tested locally |
| 10 | [FlowForge](10-flowforge-pump-efficiency/) | Utility pump-farm efficiency analytics | Java | Built & tested locally |
| 11 | [ParkFog](11-parkfog-kerbside-occupancy/) | Kerbside parking occupancy & dynamic pricing | Node.js | Built & tested locally |
| 12 | [GuardianEdge](12-guardianedge-fall-detection/) | Remote elder-care fall detection | Java | Built & tested locally |
| 13 | [GreenhouseGuard](13-greenhouseguard/) | Commercial greenhouse climate control | Node.js | Built & tested locally |
| 14 | [BinSight](14-binsight-waste-routing/) | Smart waste collection & routing | Java | Built & tested locally |
| 15 | [HarborPulse](15-harborpulse-vessel-monitoring/) | Small-fleet vessel engine & sea-state monitoring | Python | Built & tested locally |

## Repository layout

Each project is self-contained: its own sensors, fog nodes, AWS backend (CDK), dashboard, tests, and
CI/CD workflow. `infra/localstack-init/` holds the shared LocalStack bootstrap scripts; everything else
lives inside the project's own folder.
