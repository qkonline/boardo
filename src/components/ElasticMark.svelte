<script lang="ts">
  /** Elastic's app mark (its arcs), small, for pointing to the sibling app. */
  let { size = 18 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
  <rect width="512" height="512" rx="112" fill="#16181d" />
  <g fill="none" stroke-width="28">
    <path d="M86 346 A170 170 0 0 1 426 346" stroke="#818cf8" />
    <path d="M122 346 A134 134 0 0 1 390 346" stroke="#a78bfa" />
    <path d="M158 346 A98 98 0 0 1 354 346" stroke="#c084fc" />
    <path d="M194 346 A62 62 0 0 1 318 346" stroke="#f472b6" />
  </g>
  <path d="M226 346 A30 30 0 0 1 286 346 Z" fill="#f43f5e" />
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
