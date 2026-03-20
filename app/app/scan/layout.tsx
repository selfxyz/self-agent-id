// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// Bare layout for /scan/* — overrides the root shell by rendering children
// full-screen without the app Navbar, NetworkBanner, or Footer.
// The root layout still provides <html>, <body>, fonts, and ClientProviders.

export default function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f9fafb]">
      {children}
    </div>
  );
}
