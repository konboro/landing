import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { Qr } from '@/components/ui/Qr';

/** Standalone printable QR label (opened in a popup window from Vehicle detail). */
export function VehicleLabelPrint() {
  const { id = '' } = useParams();
  const ds = useDS();
  const { data } = useQuery({ queryKey: ['vehicle', id], queryFn: () => ds.getVehicle(id) });

  useEffect(() => { if (data) setTimeout(() => window.print(), 400); }, [data]);
  if (!data) return <div style={{ padding: 40 }}>Loading label…</div>;
  const v = data.vehicle;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#fff', color: '#000' }}>
      <div style={{ border: '2px solid #000', borderRadius: 16, padding: 28, width: 320, textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>PENNY</div>
        <div style={{ fontSize: 12, color: '#444', marginBottom: 14 }}>Scan to ride</div>
        <div style={{ display: 'grid', placeItems: 'center' }}><Qr value={`penny://vehicle/${v.code}`} size={190} /></div>
        <div style={{ fontFamily: 'monospace', fontSize: 30, fontWeight: 700, marginTop: 14 }}>{v.code}</div>
        <div style={{ fontSize: 12, color: '#444', marginTop: 8 }}>{v.model_name}</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>penny.rent · support +30 21 0000 0000</div>
      </div>
    </div>
  );
}
