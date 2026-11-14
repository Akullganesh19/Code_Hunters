# TraceLayer

TraceLayer is an interactive workbench for exploring anti money laundering (AML) activity across transaction networks. It brings graph exploration, alert triage, investigation notes, and case preparation into one focused interface.

## What you can do

- Explore a time based transaction graph and inspect connected accounts.
- Review alerts and trace fan in, fan out, pass through, and cycle patterns.
- Search the network, import transaction CSVs, and inspect account activity.
- Prepare SAR case material and export investigation results.
- Run the included benchmark and evaluation workflows.

## Run locally

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Project checks

```sh
npm run lint
npm test
npm run build
```

## Stack

React, TypeScript, Vite, Tailwind CSS, and Lucide.

The bundled example data is synthetic. Alerts and graph patterns are investigation cues for human review, not findings of wrongdoing.
