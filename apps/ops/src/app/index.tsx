import { Redirect } from 'expo-router';
import { useOps } from '../lib/store';

export default function Index() {
  const session = useOps((s) => s.session);
  return <Redirect href={session ? '/(tabs)' : '/login'} />;
}
