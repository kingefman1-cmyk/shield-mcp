import { Address, Banner, Box, Divider, Heading, Link, Row, Text } from '@metamask/snaps-sdk/jsx';

import type { Analysis, RiskLevel } from './analyze';
import { DISCLOSURE, SHIELD_PAGE } from './constants';

const BANNER: Record<RiskLevel, { title: string; severity: 'success' | 'warning' | 'danger'; summary: string }> = {
  low: { title: 'LOW RISK', severity: 'success', summary: 'No risky pattern found by these checks.' },
  medium: { title: 'MEDIUM RISK', severity: 'warning', summary: 'Review the flags below before you sign.' },
  high: { title: 'HIGH RISK', severity: 'danger', summary: 'A high-risk pattern was found. Do not sign unless you are sure.' },
};

const SEVERITY_LABEL = { info: 'Info', low: 'Low', medium: 'Medium', high: 'High' } as const;

const addressRow = (label: string, address: string | null) =>
  address ? (
    <Row label={label}>
      <Address address={address as `0x${string}`} />
    </Row>
  ) : null;

/**
 * Render the transaction insight panel.
 * @param props - Panel inputs.
 * @param props.analysis - The combined local and remote analysis.
 * @param props.remoteNote - Optional note about remote screening.
 * @returns The insight UI.
 */
export const Insight = ({ analysis, remoteNote }: { analysis: Analysis; remoteNote: string | null }) => {
  const banner = BANNER[analysis.riskLevel];
  const d = analysis.decoded;
  const amountLabel = d.kind === 'native_transfer' ? 'Value (wei)' : 'Amount (raw units)';
  const shownFlags = analysis.flags.slice(0, 12);
  return (
    <Box>
      <Heading>Caelara Shield</Heading>
      <Banner title={banner.title} severity={banner.severity}>
        <Text>{banner.summary}</Text>
      </Banner>
      <Row label="Action">
        <Text>{d.action}</Text>
      </Row>
      {analysis.chainName ? (
        <Row label="Chain">
          <Text>{analysis.chainName}</Text>
        </Row>
      ) : null}
      {addressRow('Token contract', d.token)}
      {d.contract && d.contract !== d.token ? addressRow('Contract', d.contract) : null}
      {addressRow(d.kind === 'set_approval_for_all' ? 'Operator' : 'Spender', d.spender)}
      {addressRow('From', d.from)}
      {addressRow('Recipient', d.recipient)}
      {d.amount === null ? null : (
        <Row label={amountLabel} variant={d.unlimited ? 'critical' : 'default'}>
          <Text>{d.amount}</Text>
        </Row>
      )}
      {d.knownRouter ? (
        <Row label="Known router">
          <Text>{d.knownRouter}</Text>
        </Row>
      ) : null}
      <Divider />
      <Text fontWeight="bold">Flags</Text>
      {shownFlags.length ? (
        shownFlags.map((f) => (
          <Text color={f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'default'}>
            {`${SEVERITY_LABEL[f.severity]}: ${f.message}`}
          </Text>
        ))
      ) : (
        <Text>None</Text>
      )}
      {remoteNote ? <Text color="alternative">{remoteNote}</Text> : null}
      <Divider />
      <Text size="sm" color="muted">
        {DISCLOSURE}
      </Text>
      <Text size="sm">
        <Link href={SHIELD_PAGE}>caelaralabs.com/shield</Link>
      </Text>
    </Box>
  );
};
