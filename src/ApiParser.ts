import fs from 'fs';
import AnalyzeAst from './AnalyzeAst';
import ApiTokenizer, { Token } from './ApiTokenizer';

export class ApiSyntaxError extends Error {
  token: Token;
  constructor(message: string, token: Token) {
    super(message);

    this.name = 'ApiSyntaxError';
    this.message = message;
    this.token = token;
    Object.setPrototypeOf(this, ApiSyntaxError.prototype);
  }
}

export type IntVariable = { variableType: 'Int'; token: Token };
export type FloatVariable = { variableType: 'Float'; token: Token };
export type StringVariable = { variableType: 'String'; token: Token };
export type BooleanVariable = { variableType: 'Boolean'; token: Token };
export type IntLiteral = { variableType: 'IntLiteral'; value: number; token: Token };
export type FloatLiteral = { variableType: 'FloatLiteral'; value: number; token: Token };
export type StringLiteral = { variableType: 'StringLiteral'; value: string; token: Token };
export type BooleanLiteral = { variableType: 'BooleanLiteral'; value: boolean; token: Token };
export type DateTimeVariable = { variableType: 'DateTime'; token: Token };

export type Builtin =
  | BooleanLiteral
  | BooleanVariable
  | FloatLiteral
  | FloatVariable
  | IntLiteral
  | IntVariable
  | StringLiteral
  | StringVariable
  | DateTimeVariable;

type defaultUnion = Builtin | TypeReference | ObjectVariable;
export type UnionItem<T = defaultUnion> = {
  type: 'UnionItem';
  token: Token;
} & T;

export type UnionVariable<T = defaultUnion> = {
  variableType: 'Union';
  unions: UnionItem<T>[];
  token: Token;
};

export type ArrayItem<T = Builtin | TypeReference> = {
  isRequired: boolean;
  token: Token;
} & T;

export type ArrayVariable<T = Builtin | TypeReference> = {
  variableType: 'Array';
  items: ArrayItem<T>;
  token: Token;
};

export type ApiResponseDefinition = {
  type: 'ApiResponseDefinition';
  status: number;
  body?: BodyType;
  headers?: HeaderType;
  token: Token;
};

type defaultFields = Builtin | TypeReference | UnionVariable | ArrayVariable;

export type ObjectField<T = RecursiveObject<defaultFields>> = {
  type: 'ObjectField';
  name: string;
  isRequired: boolean;
  token: Token;
} & T;

export interface ObjectVariable<T = RecursiveObject<defaultFields>> {
  variableType: 'Object';
  fields: ObjectField<T>[];
  token: Token;
}

type ObjectOrTypeReference<T> = ObjectVariable<T> | TypeReference;

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD';

type ParamsFieldType = ObjectField<IntVariable | FloatVariable | StringVariable>;

type ParamsType = ObjectVariable<IntVariable | FloatVariable | StringVariable>;

type RecursiveObject<T> = T | ObjectVariable<RecursiveObject<T>>;

export type TypeReference = {
  variableType: 'TypeReference';
  value: string;
  token: Token;
};

export type QueryType = ObjectOrTypeReference<IntVariable | FloatVariable | StringVariable>;

export type HeaderType = ObjectOrTypeReference<StringVariable | StringLiteral>;

export type ApiFieldDefinition = HeaderType | QueryType | ParamsType | BodyType | undefined;

export type BodyType = TypeReference | ArrayVariable | ObjectVariable;

export type ApiDefinition = {
  type: 'ApiDefinition';
  name: string;
  method: ApiMethod;
  path: string;
  params?: ParamsType;
  query?: QueryType;
  headers?: HeaderType;
  body?: BodyType;
  responses: ApiResponseDefinition[];
  token: Token;
};

export type TypeDeclaration = {
  type: 'TypeDeclaration';
  name: string;
} & (ObjectVariable | UnionVariable);

export type EnumField = {
  name: string;
  type: 'EnumField';
} & StringLiteral;

export type EnumDeclaration = {
  name: string;
  type: 'EnumDeclaration';
  fields: EnumField[];
  token: Token;
};

export type Definition = TypeDeclaration | ApiDefinition | EnumDeclaration;

export type Ast = {
  type: 'Document';
  definitions: Definition[];
};

const isBuiltIn = (value: string): value is 'Int' | 'Float' | 'String' | 'Boolean' => {
  return ['Int', 'Float', 'String', 'Boolean', 'DateTime'].includes(value);
};

const isApiMethod = (value: string): value is ApiMethod => {
  return ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'].includes(value);
};

class ApiParser {
  private tokenizer: ApiTokenizer;
  private lookahead: Token;

  parse(str: string, filename?: string): Ast {
    this.tokenizer = new ApiTokenizer(str, filename);

    this.lookahead = this.tokenizer.getNextToken();
    return this.Document();
  }

  reportAndExit(token: Token, error: string): never {
    throw new ApiSyntaxError(error, token);
  }

  Document(): Ast {
    return {
      type: 'Document',
      definitions: this.Definitions(),
    };
  }

  Definitions(): Definition[] {
    const definitions: (TypeDeclaration | ApiDefinition | EnumDeclaration)[] = [];
    while (
      this.lookahead.type === 'WORD_WITH_COLON' ||
      this.lookahead.type === 'TYPE_DECLARATION' ||
      this.lookahead.type === 'ENUM_DECLARATION'
    ) {
      if (this.lookahead.type === 'WORD_WITH_COLON') {
        definitions.push(this.ApiDefinition());
      } else if (this.lookahead.type === 'TYPE_DECLARATION') {
        definitions.push(this.TypeDeclaration());
      } else if (this.lookahead.type === 'ENUM_DECLARATION') {
        definitions.push(this.enumDeclaration());
      } else {
        this.reportAndExit(this.lookahead, 'TypeDefinition or ApiDefinition required on top-level');
      }
    }
    if (definitions.length === 0 || this.lookahead.type !== 'EOF') {
      this.reportAndExit(this.lookahead, 'TypeDefinition or ApiDefinition required on top-level');
    }
    return definitions;
  }
  enumDeclaration(): EnumDeclaration {
    const name = this.lookahead.value.replace('enum ', '');
    const enumToken = this.lookahead;
    this.eat('ENUM_DECLARATION');
    this.eat('{');
    const fields: EnumField[] = [];
    while (this.lookahead.type === 'VARIABLE_TYPE') {
      const fieldName = this.lookahead.value;
      let value = fieldName;
      const token = this.lookahead;
      this.eat('VARIABLE_TYPE');
      if ((this.lookahead as Token).type === '=') {
        this.eat('=');
        if ((this.lookahead as Token).type !== 'STRING_LITERAL') {
          this.reportAndExit(this.lookahead, 'Enum value has to be a String Literal');
        }
        value = this.lookahead.value.slice(0, -1).slice(1);
        this.eat('STRING_LITERAL');
      }
      fields.push({
        name: fieldName,
        type: 'EnumField',
        variableType: 'StringLiteral',
        value,
        token,
      });
    }
    this.eat('}');
    return {
      name,
      type: 'EnumDeclaration',
      token: enumToken,
      fields: fields,
    };
  }

  TypeDeclaration(): TypeDeclaration {
    const value = this.lookahead.value;
    if (!value) {
      this.reportAndExit(this.lookahead, 'TypeDefinition or ApiDefinition required on top-level');
    }
    const typeToken = this.lookahead;
    this.eat('TYPE_DECLARATION');
    if (this.lookahead.type === '{') {
      const x = this.simpleObjectOrTypeReference();
      if (x.variableType !== 'Object') {
        this.reportAndExit(this.lookahead, 'Type declarations can only be of Object type');
      }
      return {
        type: 'TypeDeclaration',
        name: value.replace('type ', ''),
        ...x,
        token: typeToken,
      };
    } else if (this.lookahead.type === '|') {
      return {
        type: 'TypeDeclaration',
        name: value.replace('type ', ''),
        variableType: 'Union',
        unions: this.Unions(),
        token: typeToken,
      };
    } else {
      console.log(this.lookahead);
      this.reportAndExit(this.lookahead, '"{" or "|" required');
    }
  }

  Unions(): UnionItem[] {
    const unions: UnionItem[] = [];

    while (this.lookahead.type === '|') {
      this.eat('|');

      const value = this.lookahead.value;
      if ((this.lookahead as Token).type === 'STRING_LITERAL') {
        const token = this.lookahead;
        this.eat('STRING_LITERAL');
        unions.push({
          type: 'UnionItem',
          variableType: 'StringLiteral',
          value: value.slice(0, -1).slice(1),
          token,
        });
      } else if ((this.lookahead as Token).type === 'BOOLEAN_LITERAL') {
        const token = this.lookahead;
        this.eat('BOOLEAN_LITERAL');
        unions.push({
          type: 'UnionItem',
          variableType: 'BooleanLiteral',
          value: value === 'true',
          token,
        });
      } else if ((this.lookahead as Token).type === 'INT_LITERAL') {
        const token = this.lookahead;
        this.eat('INT_LITERAL');
        unions.push({
          type: 'UnionItem',
          variableType: 'IntLiteral',
          value: Number(value),
          token,
        });
      } else if ((this.lookahead as Token).type === 'FLOAT_LITERAL') {
        const token = this.lookahead;
        this.eat('FLOAT_LITERAL');
        unions.push({
          type: 'UnionItem',
          variableType: 'FloatLiteral',
          value: Number(value),
          token,
        });
      } else if ((this.lookahead as Token).type === 'VARIABLE_TYPE') {
        const token = this.lookahead;
        this.eat('VARIABLE_TYPE');
        if (isBuiltIn(value)) {
          unions.push({
            type: 'UnionItem',
            variableType: value,
            token,
          });
        } else {
          unions.push({
            type: 'UnionItem',
            variableType: 'TypeReference',
            value,
            token,
          });
        }
      } else if ((this.lookahead as Token).type === '{') {
        const x = this.simpleObjectOrTypeReference();
        if (x.variableType === 'Array') {
          this.reportAndExit(this.lookahead, 'Arrays are not allowed inside of a union');
        }
        unions.push({
          type: 'UnionItem',
          ...x,
        });
      }
    }
    if (unions.length === 0) {
      this.reportAndExit(this.lookahead, 'At least one union-item is required');
    }
    return unions;
  }

  ApiDefinition(): ApiDefinition {
    const name = this.lookahead.value.slice(0, -1);
    const apiToken = this.lookahead;
    if (name === undefined) {
      this.reportAndExit(this.lookahead, `Expected a valid name`);
    }
    this.eat('WORD_WITH_COLON');

    const method = this.lookahead.value
      ? isApiMethod(this.lookahead.value)
        ? this.lookahead.value
        : undefined
      : undefined;
    if (method === undefined) {
      this.reportAndExit(this.lookahead, 'Expected a HTTP Method like GET, POST, etc');
    }
    this.eat('API_METHOD');

    let path = '';
    let params: ParamsType | undefined = undefined;
    const paramFields: ParamsFieldType[] = [];

    const pathToken = this.lookahead;
    while (['API_PATH_INT', 'API_PATH_FLOAT', 'API_PATH_STRING', 'API_PATH_SEGMENT'].includes(this.lookahead.type)) {
      if (this.lookahead.type === 'API_PATH_SEGMENT') {
        path += this.lookahead.value;
        this.eat('API_PATH_SEGMENT');
      } else if (this.lookahead.type === 'API_PATH_STRING') {
        path += this.lookahead.value;
        paramFields.push({
          type: 'ObjectField',
          name: this.lookahead.value.replace('/:', ''),
          variableType: 'String',
          isRequired: true,
          token: this.lookahead,
        });
        this.eat('API_PATH_STRING');
      } else if (this.lookahead.type === 'API_PATH_INT') {
        const name = this.lookahead.value.replace(/\/:(\w+)\(Int\)/, '$1');
        path += `/:${name}`;
        paramFields.push({
          type: 'ObjectField',
          name: name,
          variableType: 'Int',
          isRequired: true,
          token: this.lookahead,
        });
        this.eat('API_PATH_INT');
      } else if (this.lookahead.type === 'API_PATH_FLOAT') {
        const name = this.lookahead.value.replace(/\/:(\w+)\(Float\)/, '$1');
        path += `/:${name}`;
        paramFields.push({
          type: 'ObjectField',
          name,
          variableType: 'Float',
          isRequired: true,
          token: this.lookahead,
        });
        this.eat('API_PATH_FLOAT');
      }
    }
    if (paramFields.length > 0) {
      params = {
        variableType: 'Object',
        fields: paramFields,
        token: pathToken,
      };
    }

    if (path === '') {
      this.reportAndExit(this.lookahead, 'Expected a path /foo');
    }

    this.eat('{');

    let query: QueryType | undefined = undefined;
    let body: BodyType | undefined = undefined;
    let headers: HeaderType | undefined = undefined;

    while (this.lookahead.type && ['API_QUERY', 'API_BODY', 'API_HEADERS'].includes(this.lookahead.type)) {
      if ((this.lookahead as Token).type === 'API_QUERY') {
        this.eat('API_QUERY');
        this.disallowUnionAndArray();
        query = this.simpleObjectOrTypeReference() as QueryType; // could possible be invalid but will be validated after the whole AST is parsed
      }

      if ((this.lookahead as Token).type === 'API_BODY') {
        this.eat('API_BODY');
        body = this.simpleObjectOrTypeReference();
      }

      if ((this.lookahead as Token).type === 'API_HEADERS') {
        this.eat('API_HEADERS');
        this.disallowUnionAndArray();
        headers = this.simpleObjectOrTypeReference() as HeaderType; // could possible be invalid but will be validated after the whole AST is parsed
      }
    }

    const responses = this.Responses();
    this.eat('}');

    return {
      type: 'ApiDefinition',
      name,
      method,
      path,
      params,
      query,
      body,
      headers,
      responses,
      token: apiToken,
    };
  }

  private disallowUnionAndArray() {
    if (this.lookahead.type === '[' || this.lookahead.type === '|') {
      throw new ApiSyntaxError('Can only be a Type Reference or Object', this.lookahead);
    }
  }

  private isRequired(): boolean {
    if (this.lookahead.type === '!') {
      this.eat('!');
      return true;
    } else {
      return false;
    }
  }
  private simpleObjectOrTypeReference(): ObjectVariable | ArrayVariable | TypeReference {
    if (this.lookahead.type === '[') {
      const token = this.lookahead;
      this.eat('[');
      const itemToken = this.lookahead;
      const value = this.lookahead.value;
      this.eat('VARIABLE_TYPE');
      const isRequired = this.isRequired();
      this.eat(']');
      if (isBuiltIn(value)) {
        return {
          variableType: 'Array',
          items: {
            variableType: value,
            isRequired,
            token: itemToken,
          },
          token,
        };
      } else {
        return {
          variableType: 'Array',
          items: {
            variableType: 'TypeReference',
            value,
            isRequired,
            token: itemToken,
          },
          token,
        };
      }
    }
    if (this.lookahead.type === 'VARIABLE_TYPE') {
      const value = this.lookahead.value;
      const token = this.lookahead;
      this.eat('VARIABLE_TYPE');
      return {
        variableType: 'TypeReference',
        value,
        token,
      };
    }
    const token = this.lookahead;
    this.eat('{');
    const fields: ObjectField[] = [];
    while (this.lookahead.type === 'WORD_WITH_COLON') {
      const name = this.lookahead.value.slice(0, -1);
      this.eat('WORD_WITH_COLON');

      switch ((this.lookahead as Token).type) {
        case '|': {
          const token = this.lookahead;
          const u = this.Unions();
          u.filter((x) => x.variableType);
          fields.push({
            type: 'ObjectField',
            name,
            variableType: 'Union',
            unions: u,
            isRequired: this.isRequired(),
            token,
          });
          break;
        }
        case 'STRING_LITERAL': {
          const value = this.lookahead.value.slice(0, -1).slice(1);
          const token = this.lookahead;
          this.eat('STRING_LITERAL');
          fields.push({
            type: 'ObjectField',
            name,
            variableType: 'StringLiteral',
            value,
            isRequired: this.isRequired(),
            token,
          });
          break;
        }
        case 'INT_LITERAL': {
          const value = Number(this.lookahead.value);
          const token = this.lookahead;
          this.eat('INT_LITERAL');
          fields.push({
            type: 'ObjectField',
            name,
            variableType: 'IntLiteral',
            value,
            isRequired: this.isRequired(),
            token,
          });
          break;
        }
        case 'FLOAT_LITERAL': {
          const value = Number(this.lookahead.value);
          const token = this.lookahead;
          this.eat('FLOAT_LITERAL');
          fields.push({
            type: 'ObjectField',
            name,
            variableType: 'FloatLiteral',
            value,
            isRequired: this.isRequired(),
            token,
          });
          break;
        }
        case 'BOOLEAN_LITERAL': {
          const value = this.lookahead.value === 'true';
          const token = this.lookahead;
          this.eat('BOOLEAN_LITERAL');
          fields.push({
            type: 'ObjectField',
            name,
            variableType: 'BooleanLiteral',
            value,
            isRequired: this.isRequired(),
            token,
          });
          break;
        }
        case 'VARIABLE_TYPE': {
          const value = this.lookahead.value;
          const token = this.lookahead;
          this.eat('VARIABLE_TYPE');
          if (isBuiltIn(value)) {
            fields.push({
              type: 'ObjectField',
              name,
              variableType: value,
              isRequired: this.isRequired(),
              token,
            });
          } else {
            fields.push({
              type: 'ObjectField',
              name,
              variableType: 'TypeReference',
              value,
              isRequired: this.isRequired(),
              token,
            });
          }
          break;
        }
        case '{': {
          fields.push({
            type: 'ObjectField',
            name,
            ...this.simpleObjectOrTypeReference(),
            isRequired: this.isRequired(),
          });
          break;
        }
        case '[': {
          fields.push({
            type: 'ObjectField',
            name,
            ...this.simpleObjectOrTypeReference(),
            isRequired: this.isRequired(),
          });
          break;
        }
      }
    }
    this.eat('}');
    return {
      variableType: 'Object',
      fields,
      token,
    };
  }

  private Responses(): ApiResponseDefinition[] {
    if (this.lookahead.type !== 'API_STATUS') {
      this.reportAndExit(this.lookahead, 'Expected a HTTP status code');
    }
    const responses: ApiResponseDefinition[] = [];
    while (this.lookahead.type === 'API_STATUS') {
      const token = this.lookahead;
      const status = Number(this.lookahead.value.slice(0, -1));
      this.eat('API_STATUS');
      this.eat('{');

      let body: BodyType | undefined = undefined;
      let headers: HeaderType | undefined = undefined;
      while (['API_BODY', 'API_HEADERS'].includes(this.lookahead.type)) {
        if ((this.lookahead as Token).type === 'API_BODY') {
          this.eat('API_BODY');
          body = this.simpleObjectOrTypeReference();
        }

        if ((this.lookahead as Token).type === 'API_HEADERS') {
          this.eat('API_HEADERS');
          this.disallowUnionAndArray();
          headers = this.simpleObjectOrTypeReference() as HeaderType; // could possible be invalid but will be validated after the whole AST is parsed
        }
      }

      if ((this.lookahead as Token).type === '!') {
        this.reportAndExit(
          this.lookahead,
          '! is not allowed because `body` or `headers` are always required if specified',
        );
      }
      this.eat('}');

      responses.push({
        type: 'ApiResponseDefinition',
        status,
        body,
        headers,
        token,
      });
    }
    return responses;
  }

  private eat(tokenType: Token['type']) {
    const token = this.lookahead;
    if (token.type === 'EOF') {
      this.reportAndExit(this.lookahead, `Reached EOF, expected ${tokenType}`);
    }
    if (token.type !== tokenType) {
      this.reportAndExit(this.lookahead, `Expected ${tokenType}`);
    }
    this.lookahead = this.tokenizer.getNextToken();
    return token;
  }
}

export const parse = (str: string): Ast => {
  return AnalyzeAst(new ApiParser().parse(str));
};

export const parseFiles = (filenames: string[]): Ast => {
  const mergedAst: Ast = {
    type: 'Document',
    definitions: [],
  };
  for (const filename of filenames) {
    const data = fs.readFileSync(filename, 'utf8');
    mergedAst.definitions = [...mergedAst.definitions, ...new ApiParser().parse(data, filename).definitions];
  }
  return AnalyzeAst(mergedAst);
};
