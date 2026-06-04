export interface InputHandlers {
  onScrub(deltaPlanets: number): void;
  onScrubEnd(): void;
  onOrbit(dx: number, dy: number): void;
  onZoom(factor: number): void;
  onPick(ndcX: number, ndcY: number): void;
  onKeyStep(dir: number): void;
  onKeyJump(target: 'start' | 'end'): void;
  onUserInteract(): void;
  onLook(dx: number, dy: number): void;
}

const DRAG_THRESHOLD = 6; // px before a press becomes an orbit drag
const WHEEL_SCALE = 0.0016;
const SCRUB_END_DELAY = 140;
const TOUCH_MOVE_RANGE = 70; // px thumbstick displacement for full thrust
const TOUCH_MOVE_DEADZONE = 0.12; // radial deadzone to ignore thumb jitter

// Held-key codes (KeyboardEvent.code) used by the free-fly movement state.
const MOVE_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
]);

// Unifies wheel / pointer / touch / keyboard into high-level scene intents.
export class InputController {
  private el: HTMLElement | null = null;
  private h: InputHandlers;

  private pointerDown = false;
  private dragging = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private scrubEndTimer = 0;

  // Touch state.
  private touchMode: 'none' | 'orbit' | 'scrub' = 'none';
  private lastTouchMidY = 0;
  private lastPinchDist = 0;

  // Free-fly mode: rerouted drag, suppressed timeline intents, held-key state.
  private freeMode = false;
  private heldCodes = new Set<string>();

  // Free-fly touch controls (mobile): a touch landing on the left half of the
  // surface acts as a virtual movement thumbstick (displacement → analog
  // forward/right); a touch on the right half is a look drag. Tracked by touch
  // identifier so the two can run simultaneously.
  private freeMoveId: number | null = null;
  private freeMoveAnchorX = 0;
  private freeMoveAnchorY = 0;
  private touchForward = 0;
  private touchRight = 0;
  private freeLookId: number | null = null;
  private freeLookX = 0;
  private freeLookY = 0;

  constructor(handlers: InputHandlers) {
    this.h = handlers;
  }

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd);
    el.addEventListener('touchcancel', this.onTouchEnd);
    el.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('touchstart', this.onTouchStart);
    el.removeEventListener('touchmove', this.onTouchMove);
    el.removeEventListener('touchend', this.onTouchEnd);
    el.removeEventListener('touchcancel', this.onTouchEnd);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.heldCodes.clear();
    this.clearFreeTouch();
    this.el = null;
  }

  setFreeMode(enabled: boolean): void {
    this.freeMode = enabled;
    // Always drop any movement keys when switching modes so a key held during
    // the toggle doesn't ghost-move the camera.
    this.heldCodes.clear();
    this.clearFreeTouch();
  }

  // Drops any in-progress free-fly touch gestures so the camera can never be
  // left drifting from a touch that was cancelled, lost, or mode-switched away.
  private clearFreeTouch(): void {
    this.freeMoveId = null;
    this.freeLookId = null;
    this.touchForward = 0;
    this.touchRight = 0;
  }

  // Returns -1/0/1 along each axis derived from currently-held movement keys,
  // plus any analog contribution from the mobile movement thumbstick.
  // Diagonal normalization is the engine's responsibility.
  getMovementAxes(): { forward: number; right: number } {
    const h = this.heldCodes;
    const forward = (h.has('KeyW') ? 1 : 0) - (h.has('KeyS') ? 1 : 0) + this.touchForward;
    const right = (h.has('KeyD') ? 1 : 0) - (h.has('KeyA') ? 1 : 0) + this.touchRight;
    return { forward, right };
  }

  // Speed multiplier from modifier keys: Shift = boost (sprint), Space = creep
  // (precision). Both held just multiplies — they roughly cancel.
  getSpeedModifier(): number {
    const h = this.heldCodes;
    let mul = 1;
    if (h.has('ShiftLeft') || h.has('ShiftRight')) mul *= 3;
    if (h.has('Space')) mul *= 0.25;
    return mul;
  }

  private toNDC(clientX: number, clientY: number): [number, number] {
    const el = this.el!;
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    const y = -(((clientY - r.top) / r.height) * 2 - 1);
    return [x, y];
  }

  private onWheel = (e: WheelEvent): void => {
    if (this.freeMode) {
      // In free-fly mode the wheel has no scene meaning; let the page own it.
      return;
    }
    e.preventDefault();
    this.h.onUserInteract();
    if (e.ctrlKey) {
      this.h.onZoom(1 + e.deltaY * 0.002);
      return;
    }
    this.h.onScrub(e.deltaY * WHEEL_SCALE);
    this.scheduleScrubEnd();
  };

  private scheduleScrubEnd(): void {
    window.clearTimeout(this.scrubEndTimer);
    this.scrubEndTimer = window.setTimeout(
      () => this.h.onScrubEnd(),
      SCRUB_END_DELAY,
    );
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // touch handled separately
    this.pointerDown = true;
    this.dragging = false;
    this.downX = this.lastX = e.clientX;
    this.downY = this.lastY = e.clientY;
    this.h.onUserInteract();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerDown || e.pointerType === 'touch') return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    if (
      !this.dragging &&
      Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD
    ) {
      this.dragging = true;
    }
    if (this.dragging) {
      if (this.freeMode) this.h.onLook(dx, dy);
      else this.h.onOrbit(dx, dy);
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    // No POI picking in free mode — a stray click shouldn't reset focus.
    if (this.pointerDown && !this.dragging && !this.freeMode) {
      const [x, y] = this.toNDC(e.clientX, e.clientY);
      this.h.onPick(x, y);
    }
    this.pointerDown = false;
    this.dragging = false;
  };

  // ---- Touch (multi-touch scrub + pinch) ----
  private onTouchStart = (e: TouchEvent): void => {
    if (this.freeMode) {
      this.onFreeTouchStart(e);
      return;
    }
    this.h.onUserInteract();
    if (e.touches.length === 1) {
      this.touchMode = 'orbit';
      const t = e.touches[0]!;
      this.lastX = t.clientX;
      this.lastY = t.clientY;
      this.downX = t.clientX;
      this.downY = t.clientY;
      this.dragging = false;
    } else if (e.touches.length === 2) {
      this.touchMode = 'scrub';
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      this.lastTouchMidY = (a.clientY + b.clientY) / 2;
      this.lastPinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.freeMode) {
      this.onFreeTouchMove(e);
      return;
    }
    e.preventDefault();
    if (this.touchMode === 'orbit' && e.touches.length === 1) {
      const t = e.touches[0]!;
      const dx = t.clientX - this.lastX;
      const dy = t.clientY - this.lastY;
      if (
        !this.dragging &&
        Math.hypot(t.clientX - this.downX, t.clientY - this.downY) > DRAG_THRESHOLD
      ) {
        this.dragging = true;
      }
      if (this.dragging) this.h.onOrbit(dx, dy);
      this.lastX = t.clientX;
      this.lastY = t.clientY;
    } else if (this.touchMode === 'scrub' && e.touches.length === 2) {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const midY = (a.clientY + b.clientY) / 2;
      this.h.onScrub((this.lastTouchMidY - midY) * -0.01);
      this.lastTouchMidY = midY;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (this.lastPinchDist > 0) {
        this.h.onZoom(this.lastPinchDist / dist);
      }
      this.lastPinchDist = dist;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (this.freeMode) {
      this.onFreeTouchEnd(e);
      return;
    }
    if (this.touchMode === 'orbit' && !this.dragging) {
      const t = e.changedTouches[0];
      if (t) {
        const [x, y] = this.toNDC(t.clientX, t.clientY);
        this.h.onPick(x, y);
      }
    }
    if (this.touchMode === 'scrub') this.scheduleScrubEnd();
    if (e.touches.length === 0) {
      this.touchMode = 'none';
      this.dragging = false;
    }
  };

  // ---- Free-fly touch controls (dual-zone): left half drives a virtual
  // movement thumbstick, right half drives the look camera. ----
  private onFreeTouchStart(e: TouchEvent): void {
    if (!this.el) return;
    e.preventDefault();
    this.h.onUserInteract();
    const r = this.el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]!;
      if (t.clientX < mid) {
        // Strict zone ownership: only the first left-half touch is the stick.
        if (this.freeMoveId === null) {
          this.freeMoveId = t.identifier;
          this.freeMoveAnchorX = t.clientX;
          this.freeMoveAnchorY = t.clientY;
          this.touchForward = 0;
          this.touchRight = 0;
        }
      } else if (this.freeLookId === null) {
        this.freeLookId = t.identifier;
        this.freeLookX = t.clientX;
        this.freeLookY = t.clientY;
      }
    }
  }

  private onFreeTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]!;
      if (t.identifier === this.freeLookId) {
        this.h.onLook(t.clientX - this.freeLookX, t.clientY - this.freeLookY);
        this.freeLookX = t.clientX;
        this.freeLookY = t.clientY;
      } else if (t.identifier === this.freeMoveId) {
        let rx = (t.clientX - this.freeMoveAnchorX) / TOUCH_MOVE_RANGE;
        let fy = -(t.clientY - this.freeMoveAnchorY) / TOUCH_MOVE_RANGE;
        rx = Math.max(-1, Math.min(1, rx));
        fy = Math.max(-1, Math.min(1, fy));
        // Radial deadzone so a planted thumb's micro-jitter doesn't drift.
        if (Math.hypot(rx, fy) < TOUCH_MOVE_DEADZONE) {
          rx = 0;
          fy = 0;
        }
        this.touchRight = rx;
        this.touchForward = fy;
      }
    }
  }

  private onFreeTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const id = e.changedTouches[i]!.identifier;
      if (id === this.freeMoveId) {
        this.freeMoveId = null;
        this.touchForward = 0;
        this.touchRight = 0;
      } else if (id === this.freeLookId) {
        this.freeLookId = null;
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.freeMode) {
      // Don't steal keys from form controls (the settings panel has selects /
      // checkboxes; Space toggles a focused checkbox / opens a focused select).
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inForm =
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        tag === 'TEXTAREA' ||
        tag === 'BUTTON';
      if (!inForm && MOVE_CODES.has(e.code)) {
        // Space scrolls the page by default; arrow keys are unused here.
        if (e.code === 'Space') e.preventDefault();
        this.heldCodes.add(e.code);
        this.h.onUserInteract();
      }
      // Arrow / Home / End planet-stepping is suppressed in free mode so the
      // scrub camera doesn't fight the fly camera in the background.
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        this.h.onUserInteract();
        this.h.onKeyStep(1);
        break;
      case 'ArrowUp':
        this.h.onUserInteract();
        this.h.onKeyStep(-1);
        break;
      case 'Home':
        this.h.onKeyJump('start');
        break;
      case 'End':
        this.h.onKeyJump('end');
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    // Always clear held state, even if the key was released over a form
    // control — otherwise a key pressed on canvas and released elsewhere
    // would stay "stuck" and keep the camera drifting.
    this.heldCodes.delete(e.code);
  };

  private onWindowBlur = (): void => {
    this.heldCodes.clear();
    this.clearFreeTouch();
  };

  // Right-click pops a native context menu, which steals focus and swallows
  // the keyup events for any WASD/Space/Shift the user happens to be holding.
  // Suppress the menu in free mode so input keeps flowing; either way, clear
  // held keys so we never end up drifting forever from a phantom held key.
  private onContextMenu = (e: MouseEvent): void => {
    if (this.freeMode) e.preventDefault();
    this.heldCodes.clear();
  };

  // Same backstop for tab-switches / OS task switching where keyup may not
  // make it back to the page.
  private onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      this.heldCodes.clear();
      this.clearFreeTouch();
    }
  };
}
