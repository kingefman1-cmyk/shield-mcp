import { MethodNotFoundError, SeverityLevel } from '@metamask/snaps-sdk';
import type { OnRpcRequestHandler, OnTransactionHandler } from '@metamask/snaps-sdk';
import { Box, Heading, Link, Text } from '@metamask/snaps-sdk/jsx';

import { analyzeTransaction } from './analyze';
import { DISCLOSURE, SHIELD_PAGE } from './constants';
import { mergeRemote, screenRemote } from './remote';
import { clearKey, route, screenTransaction, setKey, status } from './rpc';
import { getApiKey } from './state';
import { Insight } from './ui';

/**
 * Transaction insight. Local decoding always runs; the remote Shield check runs only when the user stored a key.
 * Never throws: any unexpected failure still renders the disclosure.
 * @param args - Handler arguments.
 * @param args.transaction - The transaction about to be signed.
 * @param args.chainId - CAIP-2 chain ID.
 * @returns The insight panel.
 */
export const onTransaction: OnTransactionHandler = async ({ transaction, chainId }) => {
  try {
    const local = analyzeTransaction({
      chainId,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      from: transaction.from,
    });
    let analysis = local;
    let remoteNote: string | null = null;
    if (local.supportedChain) {
      const remote = await screenRemote(local, await getApiKey());
      analysis = mergeRemote(local, remote);
      remoteNote = remote.note;
    }
    return {
      content: <Insight analysis={analysis} remoteNote={remoteNote} />,
      ...(analysis.riskLevel === 'high' ? { severity: SeverityLevel.Critical } : {}),
    };
  } catch {
    return {
      content: (
        <Box>
          <Heading>Caelara Shield</Heading>
          <Text>This transaction could not be screened.</Text>
          <Text size="sm" color="muted">
            {DISCLOSURE}
          </Text>
          <Text size="sm">
            <Link href={SHIELD_PAGE}>caelaralabs.com/shield</Link>
          </Text>
        </Box>
      ),
    };
  }
};

/**
 * JSON-RPC methods for dapps.
 * @param args - Handler arguments.
 * @param args.origin - Calling origin.
 * @param args.request - The JSON-RPC request.
 * @returns The method result.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  switch (request.method) {
    case 'caelara_screenTransaction':
      return screenTransaction(request.params);
    case 'caelara_quoteScreenedRoute':
      return route('quote', request.params);
    case 'caelara_buildScreenedRoute':
      return route('build', request.params);
    case 'caelara_setApiKey':
      return setKey(origin, request.params);
    case 'caelara_clearApiKey':
      return clearKey(origin);
    case 'caelara_getStatus':
      return status();
    default:
      throw new MethodNotFoundError({ method: request.method });
  }
};
