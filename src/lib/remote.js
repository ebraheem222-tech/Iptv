import { useEffect } from "react";
export function useRemote(back) {
  useEffect(() => {
    const handler = (e) => {
      const code = e.keyCode;
      const key = e.key;
      if ([10009, 461, 27].indexOf(code) >= 0 || key === "Escape") {
        e.preventDefault();
        back();
        return;
      }
      const scope = document.querySelector("[data-modal]") || document;
      const focused = document.activeElement;
      const editing = /INPUT|TEXTAREA/.test(focused?.tagName);
      if (
        focused?.tagName === "SELECT" &&
        ["ArrowUp", "ArrowDown", "Enter"].indexOf(key) >= 0
      )
        return;
      if (editing && key !== "Tab" && key !== "ArrowDown" && key !== "ArrowUp")
        return;
      const nodes = Array.from(
        scope.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select,summary,a[href],video[controls]",
        ),
      ).filter(
        (n) =>
          n.getBoundingClientRect().width && n.getBoundingClientRect().height,
      );
      if (key === "Tab" && scope !== document) {
        e.preventDefault();
        const i = nodes.indexOf(focused);
        nodes[
          (i + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length
        ]?.focus();
        return;
      }
      const dirs = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const dir = dirs[key];
      if (!dir) return;
      e.preventDefault();
      if (nodes.indexOf(focused) < 0) {
        nodes[0]?.focus();
        return;
      }
      const r = focused.getBoundingClientRect(),
        x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      let winner = null,
        best = Infinity;
      nodes.forEach((n) => {
        if (n === focused) return;
        const a = n.getBoundingClientRect(),
          dx = a.left + a.width / 2 - x,
          dy = a.top + a.height / 2 - y;
        const main = dx * dir[0] + dy * dir[1],
          cross = Math.abs(dir[0] ? dy : dx);
        if (main <= 4) return;
        const score = main + cross * 3;
        if (score < best) {
          best = score;
          winner = n;
        }
      });
      if (winner) {
        winner.focus();
        winner.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [back]);
}
export function useModalFocus(ref) {
  useEffect(() => {
    const previous = document.activeElement;
    const timer = setTimeout(
      () => ref.current?.querySelector("button,input")?.focus(),
      20,
    );
    return () => {
      clearTimeout(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
}
