import { useIam } from '@hanzo/iam/react';
import { setUser, useApp } from '@/store/app';
import { useApi } from '../useApi';

const selector = (state: { user: any }) => state.user;

export function useLoginQuery() {
  const { post, useQuery } = useApi();
  const { isAuthenticated } = useIam();
  const user = useApp(selector);

  const query = useQuery({
    queryKey: ['login'],
    queryFn: async () => {
      const data = await post('/auth/verify');

      setUser(data);

      return data;
    },
    // Only resolve the local user once IAM has a verified session; otherwise
    // /auth/verify would 401 before the bearer is available.
    enabled: !user && isAuthenticated,
  });

  return { user, setUser, ...query };
}
