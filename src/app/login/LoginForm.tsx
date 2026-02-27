'use client';
import {
  Column,
  Form,
  FormButtons,
  FormField,
  FormSubmitButton,
  Heading,
  Icon,
  PasswordField,
  TextField,
} from '@umami/react-zen';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMessages, useUpdateQuery } from '@/components/hooks';
import { Logo } from '@/components/svg';
import { branding, isIAMEnabled } from '@/lib/branding';
import { setClientAuthToken } from '@/lib/client';
import { setUser } from '@/store/app';

function startIAMLogin() {
  const redirectUri = `${window.location.origin}/api/auth/iam`;
  const params = new URLSearchParams({
    client_id: branding.iamClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state: crypto.randomUUID(),
  });
  window.location.href = `${branding.iamUrl}/login/oauth/authorize?${params}`;
}

export function LoginForm() {
  const { formatMessage, labels, getErrorMessage } = useMessages();
  const router = useRouter();
  const { mutateAsync, error } = useUpdateQuery('/auth/login');
  const [showPassword, setShowPassword] = useState(!isIAMEnabled());
  const iamEnabled = isIAMEnabled();

  const handleSubmit = async (data: any) => {
    await mutateAsync(data, {
      onSuccess: async ({ token, user }) => {
        setClientAuthToken(token);
        setUser(user);
        router.push('/');
      },
    });
  };

  return (
    <Column justifyContent="center" alignItems="center" gap="6">
      <Icon size="lg">
        <Logo />
      </Icon>
      <Heading>{branding.name}</Heading>

      <Column gap="4" style={{ width: '100%', maxWidth: 320 }}>
        {iamEnabled && (
          <button
            type="button"
            onClick={startIAMLogin}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--base400)',
              background: 'var(--base900)',
              color: 'var(--base50)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {branding.iamProviderName
              ? `Sign in with ${branding.iamProviderName}`
              : 'Sign in with SSO'}
          </button>
        )}

        {iamEnabled && !showPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--base500)',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Sign in with username
          </button>
        )}

        {showPassword && (
          <Form onSubmit={handleSubmit} error={getErrorMessage(error)}>
            <FormField
              label={formatMessage(labels.username)}
              data-test="input-username"
              name="username"
              rules={{ required: formatMessage(labels.required) }}
            >
              <TextField autoComplete="username" />
            </FormField>

            <FormField
              label={formatMessage(labels.password)}
              data-test="input-password"
              name="password"
              rules={{ required: formatMessage(labels.required) }}
            >
              <PasswordField autoComplete="current-password" />
            </FormField>
            <FormButtons>
              <FormSubmitButton
                data-test="button-submit"
                variant="primary"
                style={{ flex: 1 }}
                isDisabled={false}
              >
                {formatMessage(labels.login)}
              </FormSubmitButton>
            </FormButtons>
          </Form>
        )}
      </Column>
    </Column>
  );
}
