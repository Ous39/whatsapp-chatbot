"use client";
import { useEffect, useState } from "react";
import { Guard } from "../../components/Guard";
import { Shell } from "../../components/Shell";
import { api } from "../../lib/api";

export default function Billing() {
  const [data, setData] = useState<any>(), [error, setError] = useState("");
  useEffect(() => { api("/billing/usage").then(setData).catch(e => setError(e.message)); }, []);
  return <Guard><Shell title="Plan and usage" subtitle="Transparent messaging limits with no hidden campaign usage.">{error && <p className="error">{error}</p>}{data && <><div className="grid"><div className="card metric"><span className="label">Current plan</span><strong>{data.plan}</strong><small>{data.planStatus}</small></div><div className="card metric"><span className="label">Campaign messages</span><strong>{data.used.toLocaleString()}</strong><small>This billing period</small></div><div className="card metric"><span className="label">Remaining</span><strong>{data.remaining.toLocaleString()}</strong><small>of {data.monthlyMessageLimit.toLocaleString()}</small></div></div><div className="card" style={{ marginTop: 18 }}><h2>Available plans</h2><table><thead><tr><th>Plan</th><th>Campaign messages/month</th><th>Availability</th></tr></thead><tbody>{data.plans.map((plan: any) => <tr key={plan.name}><td><strong>{plan.name}</strong></td><td>{plan.limit.toLocaleString()}</td><td>{plan.name === data.plan ? <span className="pill">Current plan</span> : <span className="pill gray">Contact OceanBrown</span>}</td></tr>)}</tbody></table><p className="muted small">Payment-provider checkout can be attached here without changing campaign accounting or tenant limits.</p></div></>}</Shell></Guard>;
}
