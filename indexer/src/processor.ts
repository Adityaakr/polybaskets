import {
  BlockHeader as _BlockHeader,
  DataHandlerContext,
  SubstrateBatchProcessor,
  SubstrateBatchProcessorFields,
  Event as _Event,
  Call as _Call,
  Extrinsic as _Extrinsic,
} from "@subsquid/substrate-processor";
import { Store } from "@subsquid/typeorm-store";
import { hostname } from "node:os";
import { config } from "./config";

const processorInstance = new SubstrateBatchProcessor()
  .setGateway(config.archiveUrl)
  .setRpcEndpoint({
    url: config.rpcUrl,
    rateLimit: config.rateLimit,
    headers: {
      "User-Agent": hostname(),
    },
  })
  // Vara testnet RPC is only used for metadata and should not be relied on
  // for live ingestion in this deployment.
  .setRpcDataIngestionSettings({ disabled: true })
  .setBlockRange({ from: config.fromBlock })
  .setFields({
    event: {
      args: true,
      extrinsic: true,
      call: true,
    },
    extrinsic: {
      hash: true,
      fee: true,
      signature: true,
    },
    call: {
      args: true,
    },
    block: {
      timestamp: true,
    },
  });

// Railway injects PORT for services it expects to keep alive. Bind the
// built-in SQD metrics server to that port so worker deployments can be
// treated as healthy without adding a separate HTTP server.
const metricsPort = process.env.PORT || process.env.PROMETHEUS_PORT;
if (metricsPort) {
  const parsedPort = Number(metricsPort);
  if (Number.isFinite(parsedPort) && parsedPort > 0) {
    processorInstance.setPrometheusPort(parsedPort);
  }
}

export const processor = processorInstance;

export type Fields = SubstrateBatchProcessorFields<typeof processor>;
export type BlockHeader = _BlockHeader<Fields> & { timestamp: number };
export type Event = _Event<Fields>;
export type Call = _Call<Fields>;
export type Extrinsic = _Extrinsic<Fields>;
export type ProcessorContext = DataHandlerContext<Store, Fields>;
