// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

function VerifyRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const key = searchParams.get("key");
    if (key) {
      router.replace(`/agents/verify?key=${encodeURIComponent(key)}`);
    } else {
      router.replace("/agents/verify");
    }
  }, [searchParams, router]);

  return null;
}

export default function VerifyRedirect() {
  return (
    <Suspense>
      <VerifyRedirectInner />
    </Suspense>
  );
}
