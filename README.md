# Sequence Cross App Embedded Wallet Connector

Wagmi connector for Sequence cross app embedded wallets

Wallet repository: [0xsequence/cross-app-embedded-wallet](https://github.com/0xsequence/cross-app-embedded-wallet)

## Installation

Install the connector along with its peer dependencies:

```shell
pnpm install @0xsequence/cross-app-embedded-wallet-connector @0xsequence/network@^2.0.0 ethers@^6.13.0 viem@^2.0.0 wagmi@^2.0.0
```

## Example Usage

```ts
import { http, createConfig } from "wagmi";
import { arbitrumNova, arbitrumSepolia } from "wagmi/chains";
import { sequenceCrossAppEmbeddedWallet } from "@0xsequence/cross-app-embedded-wallet-connector";

const connector = sequenceCrossAppEmbeddedWallet({
  projectAccessKey: "...", // Your project access key from sequence.build
  walletUrl: "...", // URL of the cross app embedded wallet
  chainId: arbitrumNova.id, // This is the starting chain id, chain can be switched related to transports in create config (see createConfig below)
});

export const config = createConfig({
  chains: [arbitrumNova, arbitrumSepolia],
  connectors: [connector],
  transports: {
    [arbitrumNova.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
});
```
