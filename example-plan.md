# Example Implementation Plan

This is an example implementation plan file for Stepcat. Replace this with your actual implementation plan.

Stepcat tracks progress through phase markers:
- No marker: Pending (not started)
- [implementation]: Implementation complete, awaiting build
- [review]: Build passed, awaiting code review
- [done]: All phases complete

Example of steps in different phases:
```
## Step 1: Setup [done]
## Step 2: Core Features [review]
## Step 3: Tests [implementation]
## Step 4: Documentation
```

## Step 1: Project Setup

Set up the basic project structure:
- Initialize npm project
- Install dependencies
- Configure TypeScript
- Set up linting and testing

## Step 2: Implement Core Feature

Implement the main feature:
- Create necessary modules
- Add business logic
- Integrate with external services if needed

## Step 3: Add Tests

Add comprehensive test coverage:
- Write unit tests
- Write integration tests
- Ensure all tests pass

## Step 4: Documentation

Add documentation:
- Update README with usage instructions
- Add code comments
- Create API documentation if applicable

## Step 5: Final Touches

Polish the implementation:
- Run linting and fix any issues
- Optimize performance
- Review and refactor code

---

Note: Stepcat automatically updates phase markers as work progresses:
- After implementation: "## Step 1: Project Setup [implementation]"
- After build verification: "## Step 1: Project Setup [review]"
- After code review: "## Step 1: Project Setup [done]"
