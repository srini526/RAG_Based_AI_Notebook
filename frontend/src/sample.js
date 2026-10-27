// A small built-in note so new users can try the app without uploading anything.
export const SAMPLE_NAME = "sample-javascript-closures.md";

export const SAMPLE_TEXT = `# JavaScript closures

## What is a closure?
A closure is a function that remembers the variables of the scope where it was created, even after
that outer function has finished running. Closures are how JavaScript keeps private state.

## Example: a counter
\`\`\`js
function makeCounter() {
  let count = 0;
  return function () {
    count += 1;
    return count;
  };
}

const next = makeCounter();
next(); // 1
next(); // 2
\`\`\`
The inner function keeps access to \`count\`, but nothing outside can change it directly.

## Common uses
- Data privacy: hide variables behind functions (the module pattern).
- Callbacks and event handlers that need data from the place they were defined.
- Partial application and function factories.

## A classic pitfall
Using \`var\` in a loop shares one variable between all callbacks, so they all see the final value.
Using \`let\` creates a new binding per iteration and fixes it.

## Recursion
Recursion means a function calls itself. Every recursive function needs a base case that stops the
calls, otherwise it runs until the call stack overflows.
`;
