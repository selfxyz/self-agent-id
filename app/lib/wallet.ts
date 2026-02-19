import type { NetworkConfig } from "./network";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

export async function connectWallet(network: NetworkConfig): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) {
    alert("Please install MetaMask or another wallet");
    return null;
  }

  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];

  // Switch to the selected network
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainIdHex }],
    });
  } catch (switchError: unknown) {
    if ((switchError as { code: number }).code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: network.chainIdHex,
            chainName: network.isTestnet ? "Celo Sepolia Testnet" : "Celo",
            nativeCurrency: network.nativeCurrency,
            rpcUrls: [network.rpcUrl],
            blockExplorerUrls: [network.blockExplorer],
          },
        ],
      });
    }
  }

  return accounts[0]?.toLowerCase() || null;
}
