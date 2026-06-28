# Logo Color Cycle How-To

This note documents the reusable text-logo animation pattern used for the
console wordmark. It cycles through a small rainbow palette with a soft text
glow, then falls back to a static accent color for users who prefer reduced
motion.

## Basic Markup

Use a plain text logo element with a stable base class and the animated helper
class:

```html
<h1 class="logo logo-rainbow">Product Name</h1>
```

The base class should define the normal wordmark typography:

```css
.logo {
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
}
```

## Animated Color Cycle

Add the animation class and keyframes:

```css
.logo-rainbow {
  color: #ff6b6b;
  text-shadow: 0 0 7px rgb(255 107 107 / 45%);
  animation: logo-rainbow 18s ease-in-out infinite;
}

@keyframes logo-rainbow {
  0%,
  100% {
    color: #ff6b6b;
    text-shadow: 0 0 7px rgb(255 107 107 / 45%);
  }

  16% {
    color: #f59e0b;
    text-shadow: 0 0 7px rgb(245 158 11 / 45%);
  }

  32% {
    color: #facc15;
    text-shadow: 0 0 7px rgb(250 204 21 / 42%);
  }

  48% {
    color: #22c55e;
    text-shadow: 0 0 7px rgb(34 197 94 / 45%);
  }

  64% {
    color: #06b6d4;
    text-shadow: 0 0 7px rgb(6 182 212 / 45%);
  }

  80% {
    color: #58a6ff;
    text-shadow: 0 0 7px rgb(88 166 255 / 48%);
  }
}
```

## Reduced Motion

Always keep the reduced-motion fallback with the pattern:

```css
@media (prefers-reduced-motion: reduce) {
  .logo-rainbow {
    animation: none;
    color: var(--accent-hover);
    text-shadow: 0 0 7px rgb(121 192 255 / 45%);
  }
}
```

## Optional Update State

If the same wordmark location should become an update indicator, render a
normal animated logo and a hidden button. Show the button only when an update is
available.

```html
<h1 class="logo logo-rainbow" id="app-logo">Product Name</h1>
<button
  type="button"
  class="logo logo-update"
  id="app-update-logo"
  aria-label="Update application"
  hidden
>
  Product Name
</button>
```

Use the pulsing update treatment:

```css
.logo-update {
  background: rgb(88 166 255 / 8%);
  border: 1px solid rgb(88 166 255 / 45%);
  border-radius: 7px;
  padding: 3px 8px;
  color: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 8px rgb(88 166 255 / 16%);
  text-shadow: 0 0 6px rgb(88 166 255 / 60%);
  animation: logo-pulse 1.6s ease-in-out infinite;
}

.logo-update:hover,
.logo-update:focus-visible {
  border-color: rgb(121 192 255 / 70%);
  color: var(--accent-hover);
  outline: none;
  box-shadow: 0 0 14px rgb(88 166 255 / 28%);
  text-shadow: 0 0 12px rgb(88 166 255 / 80%);
}

@keyframes logo-pulse {
  0%,
  100% {
    opacity: 1;
    text-shadow: 0 0 5px rgb(88 166 255 / 50%);
  }

  50% {
    opacity: 0.85;
    text-shadow: 0 0 12px rgb(88 166 255 / 85%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .logo-update {
    animation: none;
  }
}
```

Toggle the state from application update logic:

```js
function renderUpdateLogo(updateAvailable) {
  const logo = document.getElementById('app-logo');
  const updateLogo = document.getElementById('app-update-logo');

  logo.hidden = updateAvailable;
  updateLogo.hidden = !updateAvailable;
  updateLogo.title = updateAvailable
    ? 'Update available - click to apply'
    : '';
}
```

When the update button performs a destructive or restarting action, confirm the
action first and keep the button's `aria-label` specific to that action.
