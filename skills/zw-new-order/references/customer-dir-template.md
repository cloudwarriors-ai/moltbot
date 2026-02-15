# Customer Directory Template

When creating an order for a customer that doesn't have a customer directory yet, scaffold it using this template.

## Directory Structure

```
memory/customers/{customer-slug}/
├── index.md
├── orders/
└── docs/
```

## index.md Template

```markdown
# {Company Name} — Customer Project

- **Created**: YYYY-MM-DD
- **Updated**: YYYY-MM-DD

## Artifacts

- [Channel Knowledge Base](channel.md)

## Orders
_No orders yet._

## Documents
_No documents yet._
```

## Instructions

1. Replace `{Company Name}` with the actual company name.
2. Replace `YYYY-MM-DD` with today's date.
3. Create the `orders/` and `docs/` subdirectories (they'll be created implicitly when you write files into them).
4. After creating order files, update the `## Orders` section — replace `_No orders yet._` with links:
   ```markdown
   ## Orders
   - [{Order Name}](orders/{order-slug}.md)
   - [{Order Name} — Capture Summary](orders/{order-slug}-summary.html)
   ```
