/**
 * Coordinate the user-facing cancellation boundary around one local Codex
 * authorization flow. No credential material enters this state machine.
 */
export function createAuthorizationCommitTracker() {
  let generation = 0
  let active

  return Object.freeze({
    begin() {
      if (active !== undefined) {
        throw new Error("a Codex authorization attempt is already tracked")
      }
      const id = ++generation
      active = { id, phase: "cancellable" }
      let finished = false

      return Object.freeze({
        selectCommit() {
          if (finished || active?.id !== id || active.phase !== "cancellable") return false
          active = { id, phase: "committing" }
          return true
        },
        finish() {
          if (finished) return
          finished = true
          if (active?.id === id && active.phase === "cancellable") active = undefined
        },
      })
    },

    /** Check and run cancellation in one synchronous call stack. */
    tryCancel(cancel) {
      if (typeof cancel !== "function") throw new TypeError("cancel must be a function")
      if (active?.phase === "committing") return false
      cancel()
      return true
    },

    isCommitPending() {
      return active?.phase === "committing"
    },

    /** Called when the public authorization attempt reaches its terminal state. */
    settle() {
      active = undefined
    },
  })
}
