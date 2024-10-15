import { createConnector } from "wagmi";
import { ProviderTransport } from "./providerTransport";
import { ethers } from "ethers";
import { allNetworks, EIP1193Provider } from "@0xsequence/network";
import { getAddress, TransactionRejectedRpcError } from "viem";

sequenceCrossAppEmbeddedWallet.type =
  "sequence-cross-app-embedded-wallet" as const;

export interface SequenceCrossAppEmbeddedWalletConfig {
  projectAccessKey: string;
  walletUrl: string;
  chainId: number;
  isDev?: boolean;
}

export function sequenceCrossAppEmbeddedWallet(
  params: SequenceCrossAppEmbeddedWalletConfig
) {
  type Provider = SequenceWaasTransportProvider;
  type Properties = {
    sequenceWaasTransportProvider: SequenceWaasTransportProvider;
  };
  type StorageItem = {};

  const isDev = !!params?.isDev;
  const nodesUrl = isDev
    ? "https://dev-nodes.sequence.app"
    : "https://nodes.sequence.app";

  const sequenceWaasTransportProvider = new SequenceWaasTransportProvider(
    params.projectAccessKey,
    params.walletUrl,
    params.chainId,
    nodesUrl
  );

  return createConnector<Provider, Properties, StorageItem>((config) => ({
    id: `sequence-cross-app-embedded-wallet`,
    name: "Sequence Cross-App Embedded Wallet",
    type: sequenceCrossAppEmbeddedWallet.type,
    sequenceWaasTransportProvider,
    params,

    async setup() {
      if (typeof window !== "object") {
        // (for SSR) only run in browser client
        return;
      }
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async connect(_connectInfo) {
      const provider = await this.getProvider();
      let walletAddress = provider.transport.getWalletAddress();

      if (!walletAddress) {
        try {
          const res = await provider.transport.connect();
          walletAddress = res.walletAddress;
        } catch (e) {
          console.log(e);
          await this.disconnect();
          throw e;
        }
      }

      return {
        accounts: [getAddress(walletAddress)],
        chainId: await this.getChainId(),
      };
    },

    async disconnect() {
      const provider = await this.getProvider();

      provider.transport.disconnect();
    },

    async getAccounts() {
      const provider = await this.getProvider();

      const address = provider.transport.getWalletAddress();

      if (address) {
        return [getAddress(address)];
      }

      return [];
    },

    async getProvider(): Promise<SequenceWaasTransportProvider> {
      return sequenceWaasTransportProvider;
    },

    async isAuthorized() {
      const provider = await this.getProvider();

      return provider.transport.getWalletAddress() !== undefined;
    },

    async switchChain({ chainId }) {
      const provider = await this.getProvider();
      const chain =
        config.chains.find((c) => c.id === chainId) || config.chains[0];

      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ethers.toQuantity(chainId) }],
      });

      config.emitter.emit("change", { chainId });

      return chain;
    },

    async getChainId() {
      const provider = await this.getProvider();
      return Number(provider.getChainId());
    },

    async onAccountsChanged(accounts) {
      return { account: accounts[0] };
    },

    async onChainChanged(chain) {
      config.emitter.emit("change", { chainId: normalizeChainId(chain) });
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async onConnect(_connectInfo) {},

    async onDisconnect() {
      await this.disconnect();
    },
  }));
}

export class SequenceWaasTransportProvider
  extends ethers.AbstractProvider
  implements EIP1193Provider
{
  jsonRpcProvider: ethers.JsonRpcProvider;
  currentNetwork: ethers.Network;

  transport: ProviderTransport;

  constructor(
    public projectAccessKey: string,
    public walletUrl: string,
    public initialChainId: number,
    public nodesUrl: string
  ) {
    super(initialChainId);

    const initialChainName = allNetworks.find(
      (n) => n.chainId === initialChainId
    )?.name;
    const initialJsonRpcProvider = new ethers.JsonRpcProvider(
      `${nodesUrl}/${initialChainName}/${projectAccessKey}`
    );

    this.transport = new ProviderTransport(walletUrl);
    this.jsonRpcProvider = initialJsonRpcProvider;
    this.currentNetwork = ethers.Network.from(initialChainId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request({ method, params }: { method: string; params?: any[] }) {
    if (method === "wallet_switchEthereumChain") {
      const chainId = normalizeChainId(params?.[0].chainId);

      const networkName = allNetworks.find((n) => n.chainId === chainId)?.name;
      const jsonRpcProvider = new ethers.JsonRpcProvider(
        `${this.nodesUrl}/${networkName}/${this.projectAccessKey}`
      );

      this.jsonRpcProvider = jsonRpcProvider;
      this.currentNetwork = ethers.Network.from(chainId);

      return null;
    }

    if (method === "eth_chainId") {
      return ethers.toQuantity(this.currentNetwork.chainId);
    }

    if (method === "eth_accounts") {
      const address = this.transport.getWalletAddress();
      if (!address) {
        return [];
      }
      const account = getAddress(address);
      return [account];
    }

    if (method === "eth_sendTransaction") {
      if (!params) {
        throw new Error("No params");
      }

      const response = await this.transport.sendRequest(
        method,
        params,
        this.getChainId()
      );

      console.log("response - in transport connector", response);

      if (response.code === "transactionFailed") {
        // Failed
        throw new TransactionRejectedRpcError(
          new Error(`Unable to send transaction: ${response.data.error}`)
        );
      }

      if (response.code === "transactionReceipt") {
        // Success
        const { txHash } = response.data;
        return txHash;
      }
    }

    if (
      method === "eth_sign" ||
      method === "eth_signTypedData" ||
      method === "eth_signTypedData_v4" ||
      method === "personal_sign"
    ) {
      if (!params) {
        throw new Error("No params");
      }
      const response = await this.transport.sendRequest(
        method,
        params,
        this.getChainId()
      );

      return response.data.signature;
    }

    return await this.jsonRpcProvider.send(method, params ?? []);
  }

  async getTransaction(txHash: string) {
    return await this.jsonRpcProvider.getTransaction(txHash);
  }

  detectNetwork(): Promise<ethers.Network> {
    return Promise.resolve(this.currentNetwork);
  }

  getChainId() {
    return Number(this.currentNetwork.chainId);
  }
}

function normalizeChainId(
  chainId: string | number | bigint | { chainId: string }
) {
  if (typeof chainId === "object") return normalizeChainId(chainId.chainId);
  if (typeof chainId === "string")
    return Number.parseInt(
      chainId,
      chainId.trim().substring(0, 2) === "0x" ? 16 : 10
    );
  if (typeof chainId === "bigint") return Number(chainId);
  return chainId;
}
