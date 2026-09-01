# Pothos Experiment Manager

Pothos is a Hebrew laboratory experiment-management system for a darts-based
serial-performance study. It gives the experimenter a private control screen
and presents timing, turn information, and competition results on a separate
participant display.

## Main features

- Configurable numbers of participants, rounds, and darts
- Practice and serial-competition stages
- Per-dart, per-round, and cumulative score recording
- Synchronized Hebrew countdown and end-of-time audio cues
- Responsive participant display for a second screen or projector
- Automatic local recovery and live backup to an authorized HUJI network folder
- Detailed Excel export, including practice and competition throws

## Privacy and data

This public repository contains application source code only. It does not
contain participant records, experiment results, credentials, or database
contents. The deployed experiment system and its stored data are access
restricted; making this repository public does not make collected data public.

## Local development

Requirements: Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

To validate a production build:

```bash
pnpm build
```

## Hosting

The application is full-stack and uses server-side API routes and a D1 database.
It therefore cannot be deployed as a static GitHub Pages site without removing
core data-saving features. The live application is hosted separately from
GitHub with restricted access, while this repository is the public source of
truth for the code.

## Research use

Before using the system to collect research data, configure the storage
destination and access policy approved for your institution and study.
