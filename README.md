# SplitMate - React Bill Splitter

A simple, elegant Splitwise-style bill splitting app built with React + Vite.

## Features

- Add and remove group members
- Add shared expenses in AUD by default
- Choose who paid the bill
- Choose which members the bill should be split between
- Equal split calculation
- Consolidated member balances
- Settlement summary showing who owes whom
- Optional simplified debts to reduce the total number of repayments
- Currency selector ready for future multi-currency scaling
- Local storage persistence
- Sample data reset and clear-all actions
- Responsive UI with a consistent theme

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite, usually:

```bash
http://localhost:5173
```

## Build for production

```bash
npm run build
npm run preview
```

## Main files

```text
src/App.tsx             Main application UI and state handling
src/settlements.ts      Balance and debt simplification logic
src/money.ts            Currency formatting helpers
src/styles.css          Full app styling/theme
```

## Debt simplification logic

When `Simplify debts` is enabled, the app calculates each member's net balance, then matches debtors with creditors so the group can settle up with fewer payments.

When it is disabled, the app shows pairwise consolidated repayments based on the original expense relationships.
