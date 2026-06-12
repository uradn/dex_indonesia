import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { saveThesis, getLatestThesis } from './time-series-db.js';

export const ARM_THESIS_DESCRIPTION =
  'Save a Big Short thesis to the DB (status: armed). Call this at the end of big-short-thesis skill after computing all fields. Returns thesis ID + dashboard URL.';

export const armThesisTool = new DynamicStructuredTool({
  name: 'arm_thesis',
  description: ARM_THESIS_DESCRIPTION,
  schema: z.object({
    thesis_statement: z.string().describe('One-sentence falsifiable thesis with a specific number.'),
    primary_divergence: z.string().describe('Divergence key, e.g. political_financial_gap, idr_apbn_gap, cds_narrative_gap, sbn_foreign_exit, narrative_credibility.'),
    trigger_indicator: z.string().describe('DB indicator name that triggers this thesis, e.g. political_risk_score, sbn_foreign_ownership_pct, indonesia_cds_5y_bps.'),
    trigger_threshold: z.number().describe('Numeric threshold value for the trigger.'),
    trigger_direction: z.enum(['above', 'below']).describe('Whether trigger fires when indicator goes above or below threshold.'),
    predicted_cds_bps: z.number().optional().describe('Predicted CDS 5Y (bps) at T+12 if thesis plays out.'),
    predicted_usdidr: z.number().optional().describe('Predicted USDIDR spot at T+12 if thesis plays out.'),
    predicted_sbn10y: z.number().optional().describe('Predicted SBN 10Y yield (%) at T+12 if thesis plays out.'),
    crisis_probability: z.number().min(0).max(100).describe('Your probability estimate (0-100%) that full thesis plays out within T+12.'),
    ev_estimate: z.number().describe('Expected value estimate (% return, can be negative).'),
    kill_conditions: z.array(z.string()).min(1).max(5).describe('List of specific falsifiable conditions that kill the thesis if they fire.'),
  }),
  func: async (input) => {
    const today = new Date().toISOString().slice(0, 10);

    const id = await saveThesis({
      thesisDate: today,
      primaryDivergence: input.primary_divergence,
      thesisStatement: input.thesis_statement,
      triggerIndicator: input.trigger_indicator,
      triggerThreshold: input.trigger_threshold,
      triggerDirection: input.trigger_direction,
      predictedCdsBps: input.predicted_cds_bps ?? null,
      predictedUsdidr: input.predicted_usdidr ?? null,
      predictedSbn10y: input.predicted_sbn10y ?? null,
      crisisProbability: input.crisis_probability,
      evEstimate: input.ev_estimate,
      killConditions: input.kill_conditions,
      status: 'armed',
      createdAt: new Date().toISOString(),
    });

    return JSON.stringify({
      ok: true,
      id,
      status: 'armed',
      thesisDate: today,
      message: `Thesis #${id} armed. View at http://localhost:6080/bs — walk-forward T+3/6/12 checks run automatically every Monday 07:30 WIB.`,
    });
  },
});
