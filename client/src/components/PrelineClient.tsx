"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function PrelineClient() {
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    import("preline/non-auto").then(() => {
      if (active) window.HSStaticMethods?.autoInit();
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  return null;
}
