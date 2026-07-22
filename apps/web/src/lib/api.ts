const API_URL = import.meta.env.VITE_API_URL || '';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(access: string, refresh: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  getAccessToken() {
    return this.accessToken;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${API_URL}${path}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const isAuthEndpoint =
      path.startsWith('/api/auth/login') ||
      path.startsWith('/api/auth/register') ||
      path.startsWith('/api/auth/refresh') ||
      path.startsWith('/api/auth/forgot-password') ||
      path.startsWith('/api/auth/reset-password') ||
      path.startsWith('/api/auth/accept-invite');

    // Não envia Bearer em login/register — token velho gera 401 e confunde o fluxo
    if (this.accessToken && !isAuthEndpoint) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(this.buildUrl(path, params), {
      ...fetchOptions,
      headers,
    });

    if (response.status === 401 && this.refreshToken && !isAuthEndpoint) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(this.buildUrl(path, params), {
          ...fetchOptions,
          headers,
        });
      }
    }

    const data = await this.parseJson(response);
    if (!response.ok) {
      const errMsg =
        data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
          ? (data as { error: string }).error
          : response.status === 0 || response.status >= 500
            ? 'API indisponível. Verifique se o backend está rodando na porta 3001.'
            : 'Erro na requisição';
      throw new Error(errMsg);
    }
    if (data === null) {
      throw new Error('Resposta inválida da API (corpo vazio)');
    }
    return data as T;
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const res = await fetch(this.buildUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) {
        this.clearTokens();
        return false;
      }
      const data = (await this.parseJson(res)) as {
        data?: { accessToken?: string; refreshToken?: string };
      } | null;
      if (!data?.data?.accessToken || !data?.data?.refreshToken) {
        this.clearTokens();
        return false;
      }
      this.setTokens(data.data.accessToken, data.data.refreshToken);
      return true;
    } catch {
      this.clearTokens();
      return false;
    }
  }

  get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    init?: { headers?: Record<string, string> }
  ) {
    return this.request<T>(path, { method: 'GET', params, headers: init?.headers });
  }

  post<T>(path: string, body?: unknown, init?: { headers?: Record<string, string> }) {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: init?.headers,
    });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
