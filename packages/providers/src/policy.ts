/**
 * Políticas de gasto.
 * - free-only (predeterminada): bloquea toda solicitud facturable salvo que la protección
 *   oficial se pueda acreditar desde la app. La documentación consultada no ofrece una API
 *   para leer el estado del interruptor «Free Quota Only» ni la cuota restante, así que en
 *   este modo NO sale ninguna solicitud al proveedor. Una casilla, un saldo estimado o tener
 *   una clave no bastan.
 * - allow-billing: requiere activación deliberada. Antes de cada envío se muestra modelo,
 *   región, volumen, número máximo de solicitudes y costo (o «costo no verificado»).
 */
import { priceFor, type ProviderId, type Region } from './catalog.ts';

export type SpendPolicy = 'free-only' | 'allow-billing';

/** Mecanismos oficiales con los que la app podría acreditar protección. Ninguno disponible hoy. */
export const VERIFIABLE_PROTECTION_AVAILABLE = false;

export interface OperationPlan {
  operation: 't2v' | 'i2v' | 'continuation' | 'lastFrameChain' | 'text' | 'vision' | 'asr' | 'upload';
  model: string;
  region: Region;
  /** Proveedor. Si falta, es Alibaba. El puente lo fija desde la sesión, no desde el cliente. */
  provider?: ProviderId;
  /** Solicitudes facturables máximas (una cadena de N tramos = N). */
  maxRequests: number;
  /** Segundos de video a generar en total (si aplica). */
  videoSeconds?: number;
  resolution?: string;
  /** Lo que sale del equipo, en lenguaje claro. */
  dataOut: string[];
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  cost: { verified: true; amount: number; currency: string; source: string } | { verified: false; label: 'costo no verificado' };
}

export function decide(policy: SpendPolicy, plan: OperationPlan, opts: { maxSegmentsPerOperation: number }): PolicyDecision {
  const price = plan.resolution ? priceFor(plan.model, plan.resolution) : null;
  const cost: PolicyDecision['cost'] =
    price && plan.videoSeconds !== undefined
      ? { verified: true, amount: +(price.perSecond * plan.videoSeconds).toFixed(4), currency: price.currency, source: price.source }
      : { verified: false, label: 'costo no verificado' };
  if (plan.provider === 'gemini') {
    // Gemini solo se usa para texto y visión, con el nivel gratuito. Una clave de un proyecto
    // sin facturación no puede generar cobros: Google responde con límite de uso al agotarse.
    if (plan.operation !== 'text' && plan.operation !== 'vision') {
      return { allowed: false, reason: 'Con Gemini la app solo usa texto y visión. Generar video y transcribir requieren Alibaba Cloud.', cost };
    }
    if (plan.maxRequests > opts.maxSegmentsPerOperation) {
      return { allowed: false, reason: `La operación necesita ${plan.maxRequests} solicitudes y el límite por operación es ${opts.maxSegmentsPerOperation}.`, cost };
    }
    return {
      allowed: true,
      reason: 'Nivel gratuito de Gemini. No genera cobros si tu proyecto de Google no tiene facturación activada. Google usa estos datos para mejorar sus productos.',
      cost: { verified: false, label: 'costo no verificado' },
    };
  }
  if (policy === 'free-only') {
    if (!VERIFIABLE_PROTECTION_AVAILABLE) {
      return {
        allowed: false,
        reason:
          'Modo «Solo cuota gratuita»: la app no puede comprobar desde aquí que la protección «Free Quota Only» de Alibaba esté activa para este modelo y región, ni cuánta cuota queda. Por eso bloquea el envío. Para generar, activa esa protección en la consola de Alibaba y cambia deliberadamente a «Permitir consumo según mi cuenta».',
        cost,
      };
    }
  }
  if (plan.maxRequests > opts.maxSegmentsPerOperation) {
    return { allowed: false, reason: `La operación necesita ${plan.maxRequests} solicitudes y el límite por operación es ${opts.maxSegmentsPerOperation}.`, cost };
  }
  return { allowed: true, reason: 'Permitido por la política «Permitir consumo según mi cuenta».', cost };
}
