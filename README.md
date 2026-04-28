# SplitMate - React Bill Splitter

A simple Splitwise-style bill splitting app built with React, TypeScript and Vite.

## Features

- Add and remove group members
- Add expenses in AUD by default, with a currency selector for future scaling
- Choose who paid for each bill
- Split expenses using:
  - Equal split
  - Custom shares, such as 2 shares vs 1 share
  - Custom percentages, with validation that the total is 100%
- Preview each member's share before adding the expense
- Show consolidated balances
- Toggle simplified debt settlement to reduce the number of repayments
- View expense history
- Persist data in local storage
- Load sample data or clear all data

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Vercel

Use these settings when importing the GitHub repo into Vercel:

```txt
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```
