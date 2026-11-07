import type { StandardSchemaV1 } from '@standard-schema/spec';

const validate = async (schema: StandardSchemaV1, data: unknown) => {
  const result = await schema['~standard'].validate(data);

  if (result.issues) {
    throw new Error(result.issues.map(({ message }) => message).join('; '));
  }

  return result.value;
};

// NOTE: The mutator validates through the Standard Schema interface, so it does
// not depend on the library that created the schema.
export const customFetch = async <T>(
  url: string,
  options: RequestInit & { schema?: StandardSchemaV1 },
): Promise<T> => {
  const { schema, ...init } = options;

  const response = await fetch(url, init);
  const data: unknown = await response.json();

  return {
    data: schema && response.ok ? await validate(schema, data) : data,
    status: response.status,
    headers: response.headers,
  } as T;
};
