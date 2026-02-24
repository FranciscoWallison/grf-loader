# Formato GRF - Documentacao Tecnica Completa

## Indice

1. [Visao Geral](#1-visao-geral)
2. [Estrutura do Arquivo GRF](#2-estrutura-do-arquivo-grf)
3. [Header (Cabecalho)](#3-header-cabecalho)
4. [File Table (Tabela de Arquivos)](#4-file-table-tabela-de-arquivos)
5. [File Entry (Entrada de Arquivo)](#5-file-entry-entrada-de-arquivo)
6. [Criptografia DES](#6-criptografia-des)
7. [Compressao](#7-compressao)
8. [Encoding de Nomes](#8-encoding-de-nomes)
9. [Diferencas entre 0x200 e 0x300](#9-diferencas-entre-0x200-e-0x300)
10. [Pipeline de Extracao](#10-pipeline-de-extracao)
11. [Validacao com GRFEditor](#11-validacao-com-grfeditor)
12. [Arquitetura do grf-loader](#12-arquitetura-do-grf-loader)
13. [API Publica](#13-api-publica)
14. [Referencia Cruzada](#14-referencia-cruzada)

---

## 1. Visao Geral

O formato GRF (Game Resource File) e o formato de arquivo compactado usado pelo Ragnarok Online
para armazenar todos os assets do jogo: sprites, mapas, sons, texturas, modelos 3D, scripts Lua, etc.

### Versoes

| Versao | Hex | Descricao |
|--------|-----|-----------|
| 1.0x | 0x100 | Formato antigo, nomes DES-encoded, nao suportado |
| 2.0x | 0x200 | Formato padrao, offsets 32-bit (max ~4GB) |
| 3.0x | 0x300 | Formato largo, offsets 64-bit (sem limite pratico) |

O `grf-loader` suporta **0x200** e **0x300**.

### Caracteristicas

- Compressao zlib (deflate/inflate)
- Criptografia DES customizada da Gravity
- Nomes de arquivo em CP949/EUC-KR (coreano) ou UTF-8
- Lookup case-insensitive (Windows)

---

## 2. Estrutura do Arquivo GRF

```
+------------------------------------------------------+
|                    HEADER (46 bytes)                  |
+------------------------------------------------------+
|                                                      |
|              DADOS DOS ARQUIVOS (raw data)            |
|              (offsets relativos ao byte 46)           |
|                                                      |
+------------------------------------------------------+
|                  FILE TABLE (comprimida)              |
|  [skip:4]*  [compressedSize:4]  [realSize:4]  [data] |
+------------------------------------------------------+

* skip de 4 bytes existe apenas na versao 0x300
```

O header esta no inicio. Os dados dos arquivos ficam entre o header e a file table.
A file table fica no final, comprimida com zlib.

---

## 3. Header (Cabecalho)

### Layout: 46 bytes totais

```
Offset  Tam  Campo              Descricao
------  ---  -----------------  -------------------------------------------
0x00    15   signature          "Master of Magic" (sem null terminator)
0x0F    15   encryption_key     Chave (reservado, nao usado na pratica)
0x1E    4/8  file_table_offset  Offset da file table (relativo ao inicio)
0x22    4    seeds / parte_alta  Seed (0x200) ou high word do offset (0x300)
0x26    4    file_count         Numero de arquivos
0x2A    4    version            Versao do formato (0x200 ou 0x300)
```

### Versao 0x200 (layout no offset 0x1E)

```
0x1E  [table_offset : uint32]    -> offset + 46 = posicao real
0x22  [seed          : uint32]    -> usado no calculo: fileCount = raw - seed - 7
0x26  [raw_count     : uint32]    -> fileCount = raw_count - seed - 7
0x2A  [version       : uint32]    -> 0x00000200
```

### Versao 0x300 (layout no offset 0x1E)

```
0x1E  [table_offset_low  : uint32]  -> parte baixa do offset 64-bit
0x22  [table_offset_high : uint32]  -> parte alta (offset = high * 2^32 + low + 46)
0x26  [file_count        : uint32]  -> contagem direta (sem seed)
0x2A  [version           : uint32]  -> 0x00000300
```

### Heuristica de Seguranca (0x300)

Retirada do GRFEditor: quando a versao diz 0x300, verificar se os bytes 35-37
(os 3 bytes superiores do high word) sao zero:

```typescript
if ((high >>> 8) !== 0) {
  // Fallback para parsing 0x200 (GRF mal-tagueado)
}
```

Isso protege contra GRFs onde a versao diz 0x300 mas o layout e 0x200.
O high word do offset 64-bit nao pode ultrapassar 0xFF para GRFs reais
(isso permitiria offsets de ate ~1TB, mais que suficiente).

### Implementacao (grf-base.ts:221-275)

```typescript
private async parseHeader(): Promise<void> {
  const reader = await this.getStreamReader(0, HEADER_SIZE); // 46 bytes

  // 1. Verificar assinatura
  const signature = reader.getString(15); // "Master of Magic"
  if (signature !== HEADER_SIGNATURE) {
    throw new GrfError('INVALID_MAGIC', ...);
  }

  // 2. Pular encryption key (15 bytes)
  reader.skip(15);
  const afterKey = reader.tell(); // posicao 30

  // 3. Peek da versao no offset 42
  reader.seek(42);
  this.version = reader.getUint32();

  // 4. Voltar para offset 30 e parsear conforme versao
  reader.seek(afterKey);

  if (this.version === 0x200) {
    this.fileTableOffset = reader.getUint32() + HEADER_SIZE;
    const reservedFiles = reader.getUint32();
    this.fileCount = reader.getUint32() - reservedFiles - 7;
  } else {
    const low = reader.getUint32();
    const high = reader.getUint32();
    // Heuristica GRFEditor
    if ((high >>> 8) !== 0) {
      // Fallback 0x200
    } else {
      this.fileTableOffset = high * 0x100000000 + low + HEADER_SIZE;
      this.fileCount = reader.getUint32();
    }
  }
}
```

---

## 4. File Table (Tabela de Arquivos)

A file table fica no final do arquivo GRF, na posicao indicada pelo header.

### Estrutura

```
Versao 0x200:
  [compressedSize : uint32]  -> tamanho comprimido da tabela
  [realSize       : uint32]  -> tamanho descomprimido
  [compressed_data ...]      -> dados zlib

Versao 0x300:
  [skip           : uint32]  -> 4 bytes extras (sempre 0, reservado)
  [compressedSize : uint32]  -> tamanho comprimido da tabela
  [realSize       : uint32]  -> tamanho descomprimido
  [compressed_data ...]      -> dados zlib
```

Apos descomprimir com zlib (inflate), os dados contem as entries dos arquivos
concatenadas sequencialmente.

### Implementacao (grf-base.ts:277-313)

```typescript
private async parseFileList(): Promise<void> {
  // 0x300 tem 4 bytes extras antes da tabela
  const tableSkip = this.version === 0x300 ? 4 : 0;

  const reader = await this.getStreamReader(
    this.fileTableOffset + tableSkip,
    FILE_TABLE_SIZE  // 8 bytes (2 x uint32)
  );
  const compressedSize = reader.getUint32();
  const realSize = reader.getUint32();

  // Ler e descomprimir
  const compressed = await this.getStreamBuffer(...);
  const data = pako.inflate(compressed);
}
```

---

## 5. File Entry (Entrada de Arquivo)

Cada entry na tabela descomprimida tem:

```
[filename : string_null_terminated]   -> nome do arquivo (CP949 ou UTF-8)
[compressedSize : int32]              -> tamanho comprimido
[lengthAligned  : int32]              -> tamanho alinhado (para DES, multiplo de 8)
[realSize       : int32]              -> tamanho real descomprimido
[type           : byte]               -> flags (arquivo, criptografia)
[offset         : uint32 ou uint64]   -> offset dos dados (relativo ao header)
```

### Tamanho das Entries

| Versao | Campos apos filename | Offset | Total apos null |
|--------|---------------------|--------|-----------------|
| 0x200 | 4+4+4+1+**4** | uint32 | **17 bytes** |
| 0x300 | 4+4+4+1+**8** | uint64 | **21 bytes** |

### Flags (type)

```
Bit 0 (0x01): FILELIST_TYPE_FILE           -> E um arquivo (nao pasta)
Bit 1 (0x02): FILELIST_TYPE_ENCRYPT_MIXED  -> DES misto (header + ciclico + shuffle)
Bit 2 (0x04): FILELIST_TYPE_ENCRYPT_HEADER -> DES somente header (primeiros 20 blocos)
```

Combinacoes comuns:

| Flags | Hex | Descricao |
|-------|-----|-----------|
| File | 0x01 | Arquivo sem criptografia |
| File + Mixed | 0x03 | DES completo (header + ciclico + shuffle) |
| File + Header | 0x05 | DES somente nos primeiros 20 blocos |
| (nenhum) | 0x00 | Diretorio (ignorado) |

### Offset dos Dados

O offset armazenado na entry e **relativo ao inicio da area de dados**, que comeca
logo apos o header de 46 bytes. Na extracao:

```
posicao_real = entry.offset + HEADER_SIZE  // entry.offset + 46
```

### Implementacao (grf-base.ts:356-461)

```typescript
for (let i = 0, p = 0; i < this.fileCount; ++i) {
  // Ler filename ate null terminator
  let endPos = p;
  while (data[endPos] !== 0) endPos++;
  const filename = decodeFilenameBytes(data.subarray(p, endPos), encoding);
  p = endPos + 1;

  // Ler campos fixos
  const compressedSize = data[p++] | (data[p++] << 8) | ...;  // little-endian
  const lengthAligned  = data[p++] | (data[p++] << 8) | ...;
  const realSize       = data[p++] | (data[p++] << 8) | ...;
  const type           = data[p++];

  // Offset: 4 bytes (0x200) ou 8 bytes (0x300)
  if (this.version === 0x300) {
    const low = (...) >>> 0;
    const high = (...) >>> 0;
    offset = high * 0x100000000 + low;
  } else {
    offset = (...) >>> 0;
  }

  // Registrar se for arquivo
  if (entry.type & FILELIST_TYPE_FILE) {
    this.files.set(filename, entry);
  }
}
```

---

## 6. Criptografia DES

O Ragnarok Online usa uma versao **customizada** do DES (Data Encryption Standard).
Nao e DES padrao — tem S-boxes customizadas, apenas 1 round, e nenhuma chave (keyless).

### 6.1 Visao Geral do Algoritmo

Cada bloco de 8 bytes e processado assim:

```
Bloco (8 bytes)
     |
     v
[Initial Permutation (IP)]     -> Reordena os 64 bits
     |
     v
[Round Function]               -> 1 unico round (nao 16 como DES padrao)
  |-- Expansion (E)            -> 32 bits -> 48 bits (8 x 6-bit)
  |-- S-Box Substitution       -> 4 S-boxes customizadas (nao 8)
  |-- Transposition (P-Box)    -> Permutacao dos 32 bits resultantes
  |-- XOR                      -> Resultado XOR com metade esquerda
     |
     v
[Final Permutation (FP)]       -> Inversa da IP
     |
     v
Bloco decriptado
```

### 6.2 Tabelas

#### Initial Permutation (IP) - 64 posicoes, 1-based

```
58, 50, 42, 34, 26, 18, 10,  2,
60, 52, 44, 36, 28, 20, 12,  4,
62, 54, 46, 38, 30, 22, 14,  6,
64, 56, 48, 40, 32, 24, 16,  8,
57, 49, 41, 33, 25, 17,  9,  1,
59, 51, 43, 35, 27, 19, 11,  3,
61, 53, 45, 37, 29, 21, 13,  5,
63, 55, 47, 39, 31, 23, 15,  7
```

#### Final Permutation (FP) - 64 posicoes, 1-based

```
40,  8, 48, 16, 56, 24, 64, 32,
39,  7, 47, 15, 55, 23, 63, 31,
38,  6, 46, 14, 54, 22, 62, 30,
37,  5, 45, 13, 53, 21, 61, 29,
36,  4, 44, 12, 52, 20, 60, 28,
35,  3, 43, 11, 51, 19, 59, 27,
34,  2, 42, 10, 50, 18, 58, 26,
33,  1, 41,  9, 49, 17, 57, 25
```

#### Transposition (P-Box) - 32 posicoes, 1-based

```
16,  7, 20, 21,  29, 12, 28, 17,
 1, 15, 23, 26,   5, 18, 31, 10,
 2,  8, 24, 14,  32, 27,  3,  9,
19, 13, 30,  6,  22, 11,  4, 25
```

#### S-Boxes (4 caixas, 64 bytes cada)

Diferente do DES padrao que tem 8 S-boxes de 64 valores, o RO usa 4 S-boxes
de 64 bytes cada. Cada S-box recebe um indice de 6 bits e retorna 1 byte.

**S-Box 0:**
```
0xef,0x03,0x41,0xfd,0xd8,0x74,0x1e,0x47, 0x26,0xef,0xfb,0x22,0xb3,0xd8,0x84,0x1e,
0x39,0xac,0xa7,0x60,0x62,0xc1,0xcd,0xba, 0x5c,0x96,0x90,0x59,0x05,0x3b,0x7a,0x85,
0x40,0xfd,0x1e,0xc8,0xe7,0x8a,0x8b,0x21, 0xda,0x43,0x64,0x9f,0x2d,0x14,0xb1,0x72,
0xf5,0x5b,0xc8,0xb6,0x9c,0x37,0x76,0xec, 0x39,0xa0,0xa3,0x05,0x52,0x6e,0x0f,0xd9
```

**S-Box 1:**
```
0xa7,0xdd,0x0d,0x78,0x9e,0x0b,0xe3,0x95, 0x60,0x36,0x36,0x4f,0xf9,0x60,0x5a,0xa3,
0x11,0x24,0xd2,0x87,0xc8,0x52,0x75,0xec, 0xbb,0xc1,0x4c,0xba,0x24,0xfe,0x8f,0x19,
0xda,0x13,0x66,0xaf,0x49,0xd0,0x90,0x06, 0x8c,0x6a,0xfb,0x91,0x37,0x8d,0x0d,0x78,
0xbf,0x49,0x11,0xf4,0x23,0xe5,0xce,0x3b, 0x55,0xbc,0xa2,0x57,0xe8,0x22,0x74,0xce
```

**S-Box 2:**
```
0x2c,0xea,0xc1,0xbf,0x4a,0x24,0x1f,0xc2, 0x79,0x47,0xa2,0x7c,0xb6,0xd9,0x68,0x15,
0x80,0x56,0x5d,0x01,0x33,0xfd,0xf4,0xae, 0xde,0x30,0x07,0x9b,0xe5,0x83,0x9b,0x68,
0x49,0xb4,0x2e,0x83,0x1f,0xc2,0xb5,0x7c, 0xa2,0x19,0xd8,0xe5,0x7c,0x2f,0x83,0xda,
0xf7,0x6b,0x90,0xfe,0xc4,0x01,0x5a,0x97, 0x61,0xa6,0x3d,0x40,0x0b,0x58,0xe6,0x3d
```

**S-Box 3:**
```
0x4d,0xd1,0xb2,0x0f,0x28,0xbd,0xe4,0x78, 0xf6,0x4a,0x0f,0x93,0x8b,0x17,0xd1,0xa4,
0x3a,0xec,0xc9,0x35,0x93,0x56,0x7e,0xcb, 0x55,0x20,0xa0,0xfe,0x6c,0x89,0x17,0x62,
0x17,0x62,0x4b,0xb1,0xb4,0xde,0xd1,0x87, 0xc9,0x14,0x3c,0x4a,0x7e,0xa8,0xe2,0x7d,
0xa0,0x9f,0xf6,0x5c,0x6a,0x09,0x8d,0xf0, 0x0f,0xe3,0x53,0x25,0x95,0x36,0x28,0xcb
```

#### Mask - 8 bytes

```
0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01
```

Mascaras de bit individuais, MSB primeiro. Usadas em todas as permutacoes para
testar/setar bits individuais.

### 6.3 Round Function (Detalhado)

A round function opera sobre um bloco de 8 bytes dividido em:
- **Metade esquerda** (L): bytes 0-3 (32 bits)
- **Metade direita** (R): bytes 4-7 (32 bits)

#### Passo 1: Expansion (E)

Expande 32 bits (R) em 48 bits (8 valores de 6 bits):

```
tmp[0] = ((R[3] << 5) | (R[0] >> 3)) & 0x3f
tmp[1] = ((R[0] << 1) | (R[1] >> 7)) & 0x3f
tmp[2] = ((R[0] << 5) | (R[1] >> 3)) & 0x3f
tmp[3] = ((R[1] << 1) | (R[2] >> 7)) & 0x3f
tmp[4] = ((R[1] << 5) | (R[2] >> 3)) & 0x3f
tmp[5] = ((R[2] << 1) | (R[3] >> 7)) & 0x3f
tmp[6] = ((R[2] << 5) | (R[3] >> 3)) & 0x3f
tmp[7] = ((R[3] << 1) | (R[0] >> 7)) & 0x3f
```

#### Passo 2: S-Box Substitution

Cada par de valores de 6 bits alimenta uma S-box. Otimizado para processar
dois nibbles de uma vez:

```
for i = 0..3:
  result[i] = (S[i][expanded[i*2]] & 0xF0) | (S[i][expanded[i*2+1]] & 0x0F)
```

Resultado: 4 bytes (32 bits).

#### Passo 3: Transposition (P-Box)

Permuta os 32 bits do resultado da S-box usando a tabela de transposicao.
O resultado vai para os bytes 4-7 (posicao da metade direita).

#### Passo 4: XOR

```
L[0] ^= resultado[4]
L[1] ^= resultado[5]
L[2] ^= resultado[6]
L[3] ^= resultado[7]
```

### 6.4 Modos de Decriptacao

#### Modo ENCRYPT_HEADER (flags 0x05)

Somente os primeiros 20 blocos (160 bytes) sao decriptados com DES.
O restante e plaintext.

```typescript
function decodeHeader(src, length) {
  const count = length >> 3;  // numero de blocos de 8 bytes
  for (let i = 0; i < 20 && i < count; ++i) {
    decryptBlock(src, i * 8);
  }
}
```

#### Modo ENCRYPT_MIXED (flags 0x03)

Decriptacao completa com tres mecanismos:

1. **Primeiros 20 blocos**: DES em todos
2. **Blocos 20+, a cada N blocos (ciclo)**: DES
3. **Blocos 20+, a cada 7 blocos nao-DES**: Shuffle

##### Calculo do Ciclo

O ciclo depende do numero de digitos do `compressedSize`:

```
digitos    ciclo    explicacao
--------  ------   -----------
< 3          1      Arquivos < 100 bytes (irrelevante, < 20 blocos)
  3          4      digitos + 1
  4          5      digitos + 1
  5         14      digitos + 9
  6         15      digitos + 9
  7         22      digitos + 15
  8         23      digitos + 15
  9         24      digitos + 15
```

##### Logica Completa

```typescript
function decodeFull(src, length, entryLength) {
  const digits = entryLength.toString().length;
  const cycle = digits < 3 ? 1
              : digits < 5 ? digits + 1
              : digits < 7 ? digits + 9
              : digits + 15;

  const nblocks = length >> 3;

  // Fase 1: primeiros 20 blocos = DES
  for (let i = 0; i < 20 && i < nblocks; ++i) {
    decryptBlock(src, i * 8);
  }

  // Fase 2: blocos 20+ = ciclico DES + shuffle
  for (let i = 20, j = -1; i < nblocks; ++i) {
    if (i % cycle === 0) {
      decryptBlock(src, i * 8);  // DES ciclico
      continue;
    }
    if (++j && j % 7 === 0) {
      shuffleDec(src, i * 8);   // Shuffle a cada 7
    }
  }
}
```

### 6.5 Shuffle Decode

Reorganizacao de bytes dentro de um bloco de 8 bytes:

```
saida[0] = entrada[3]
saida[1] = entrada[4]
saida[2] = entrada[6]
saida[3] = entrada[0]
saida[4] = entrada[1]
saida[5] = entrada[2]
saida[6] = entrada[5]
saida[7] = shuffleDecTable[entrada[7]]   // substituicao pelo byte 7
```

#### Tabela de Substituicao do Shuffle

7 pares de swap bidirecionais. Todos os outros bytes mapeiam para si mesmos:

```
0x00 <-> 0x2B
0x6C <-> 0x80
0x01 <-> 0x68
0x48 <-> 0x77
0x60 <-> 0xFF
0xB9 <-> 0xC0
0xFE <-> 0xEB
```

Construida como uma tabela de 256 bytes onde cada indice mapeia para si mesmo,
exceto os 14 valores acima que sao trocados entre si.

### 6.6 Diagrama Visual

```
                    Arquivo encriptado
                          |
          +---------------+---------------+
          |               |               |
    Flags = 0x01    Flags = 0x03    Flags = 0x05
    (sem crypto)    (MIXED)         (HEADER)
          |               |               |
          v               v               v
     [plaintext]    [decodeFull()]   [decodeHeader()]
          |               |               |
          |        +------+------+        |
          |        |      |      |        |
          |      Blocos  Ciclico Shuffle  Blocos
          |      0-19    DES     a cada   0-19
          |      (DES)   a cada  7 nao-   (DES)
          |              N       DES      |
          |              blocos           |
          +------+--------+------+-------+
                 |
                 v
          [zlib inflate]
                 |
                 v
          Dados originais
```

---

## 7. Compressao

Todos os dados de arquivos (apos decriptacao, se aplicavel) sao comprimidos com **zlib** (deflate).

```typescript
// Se nao ha compressao (compressedSize == realSize), retorna direto
if (entry.realSize === entry.compressedSize) {
  return data;
}

// Caso contrario, descomprimir
return pako.inflate(data);
```

A biblioteca usada e `pako` (implementacao JavaScript pura do zlib).

---

## 8. Encoding de Nomes

### Problema

Os nomes de arquivo no GRF sao armazenados como bytes raw, tipicamente em
**CP949** (superset coreano do EUC-KR) ou **UTF-8**. O encoding nao e indicado
no header — precisa ser detectado.

### Auto-deteccao

O grf-loader implementa deteccao automatica:

1. Amostra ate 200 nomes de arquivo
2. Decodifica cada um como UTF-8 e como CP949
3. Conta caracteres "ruins" (U+FFFD replacements + C1 control chars)
4. Escolhe o encoding com menos erros

```typescript
// Logica simplificada
if (utf8BadRatio < threshold) return 'utf-8';     // UTF-8 perfeito
if (cp949BadRatio < utf8BadRatio) return 'cp949';  // CP949 melhor
return 'utf-8';                                    // padrao
```

### Mojibake

Quando bytes CP949 sao interpretados como Windows-1252, gera "mojibake":

```
Original (CP949): 유저인터페이스
Mojibake (Win-1252): À¯ÀúÀÎÅÍÆäÀÌ½º
```

O `decoder.ts` inclui funcoes para detectar e corrigir mojibake:

- `isMojibake(str)` - Detecta padroes comuns de mojibake
- `fixMojibake(str)` - Re-codifica Win-1252 -> CP949
- `normalizeFilename(str)` - Detecta e corrige automaticamente

### Encodings Suportados

| Encoding | Descricao |
|----------|-----------|
| `'auto'` | Deteccao automatica (padrao) |
| `'utf-8'` | Unicode UTF-8 |
| `'cp949'` | Code Page 949 (superset de EUC-KR) |
| `'euc-kr'` | Extended Unix Code Korean (tratado como cp949) |
| `'latin1'` | ISO 8859-1 / Windows-1252 |

### Dependencias de Encoding

- **Node.js**: Usa `iconv-lite` para suporte completo a CP949
- **Browser**: Usa `TextDecoder('euc-kr')` (suporte parcial ao CP949 extendido)

---

## 9. Diferencas entre 0x200 e 0x300

### Tabela Comparativa Completa

| Aspecto | 0x200 | 0x300 |
|---------|-------|-------|
| **Header offset** | uint32 (4 bytes) | uint64 (8 bytes) |
| **Adicao ao offset** | + 46 (HEADER_SIZE) | + 46 (HEADER_SIZE) |
| **Seed no header** | Sim (uint32) | Nao |
| **File count** | `raw - seed - 7` | `raw` (direto) |
| **Skip antes da tabela** | 0 bytes | 4 bytes |
| **Entry data size** | 17 bytes | 21 bytes |
| **Entry offset** | uint32 (4 bytes) | uint64 (8 bytes) |
| **Limite de tamanho** | ~4 GB (2^32) | ~16 EB (2^53 no JS) |
| **DES** | Suportado | Suportado (mesmo algoritmo) |
| **Compressao** | zlib | zlib (mesmo) |
| **Encoding nomes** | CP949/UTF-8 | CP949/UTF-8 (mesmo) |

### Offset 64-bit em JavaScript

JavaScript Number tem precisao de 53 bits (Number.MAX_SAFE_INTEGER = 2^53 - 1).
Para reconstruir offsets 64-bit:

```typescript
// Ler como dois uint32 em little-endian
const low = reader.getUint32();   // bits 0-31
const high = reader.getUint32();  // bits 32-63

// Reconstruir (seguro ate 2^53 = ~9 PB)
const offset = high * 0x100000000 + low;
```

Isso e seguro para GRFs de ate ~9 petabytes (mais que qualquer caso real).

---

## 10. Pipeline de Extracao

### Fluxo Completo para Extrair um Arquivo

```
1. LOOKUP
   filename -> resolvePath() -> entry
   (case-insensitive, slash-agnostic)

2. LEITURA
   posicao = entry.offset + 46  (HEADER_SIZE)
   tamanho = entry.lengthAligned
   data = read(fd, posicao, tamanho)

3. DECRIPTACAO (condicional)
   if (type & 0x02)  -> decodeFull(data, lengthAligned, compressedSize)
   if (type & 0x04)  -> decodeHeader(data, lengthAligned)
   if (type == 0x01) -> nada (plaintext)

4. DESCOMPRESSAO (condicional)
   if (realSize != compressedSize) -> pako.inflate(data)
   else -> dados ja sao o final

5. RESULTADO
   Uint8Array com os dados originais do arquivo
```

### Implementacao (grf-base.ts:464-478)

```typescript
private decodeEntry(data: Uint8Array, entry: TFileEntry): Uint8Array {
  // Decriptar
  if (entry.type & FILELIST_TYPE_ENCRYPT_MIXED) {
    decodeFull(data, entry.lengthAligned, entry.compressedSize);
  } else if (entry.type & FILELIST_TYPE_ENCRYPT_HEADER) {
    decodeHeader(data, entry.lengthAligned);
  }

  // Descomprimir
  if (entry.realSize === entry.compressedSize) {
    return data;
  }
  return pako.inflate(data);
}
```

---

## 11. Validacao com GRFEditor

A implementacao foi validada byte-a-byte contra o **GRFEditor** (implementacao
de referencia em C# por Tokeiburu). Todos os itens conferem:

| Item | Resultado |
|------|-----------|
| Tabela IP (64 bytes) | Identico |
| Tabela FP (64 bytes) | Identico |
| Tabela TP (32 bytes) | Identico |
| S-Box 0 (64 bytes) | Identico |
| S-Box 1 (64 bytes) | Identico |
| S-Box 2 (64 bytes) | Identico |
| S-Box 3 (64 bytes) | Identico |
| Mask (8 bytes) | Identico |
| Expansion (E) | Identico |
| S-Box substitution | Identico |
| Round function | Identico |
| Calculo de ciclo | Funcionalmente equivalente |
| Shuffle decode (ordem) | Identico |
| Shuffle swap table (7 pares) | Identico |
| Flags de encriptacao | Identico (nomes diferentes) |
| Header 0x200 parsing | Identico |
| Header 0x300 parsing | Identico |
| Heuristica 0x300 | Identico |
| File table skip 0x300 | Identico (4 bytes) |
| Entry size 0x200/0x300 | Identico (17/21) |
| Offset 64-bit | Identico (low + high * 2^32) |
| Pipeline de extracao | Identico (read -> DES -> zlib) |

### Diferenca nos Nomes dos Flags

```
grf-loader                  GRFEditor (C#)
--------------------------  ---------------------------
FILELIST_TYPE_ENCRYPT_MIXED  HeaderCrypted (0x02)
FILELIST_TYPE_ENCRYPT_HEADER DataCrypted (0x04)
```

Os nomes sao confusos no GRFEditor (historico), mas os bits e comportamentos
sao identicos.

---

## 12. Arquitetura do grf-loader

### Modulos

```
src/
 |-- index.ts          Exportacoes publicas
 |-- grf-base.ts       Classe abstrata GrfBase<T> (core do parser)
 |-- grf-node.ts       GrfNode (implementacao Node.js com file descriptors)
 |-- grf-browser.ts    GrfBrowser (implementacao browser com File API)
 |-- des.ts            Decriptacao DES customizada do RO
 |-- decoder.ts        Encoding (CP949, UTF-8, mojibake)
 |-- buffer-pool.ts    Pool de buffers para performance
```

### Diagrama de Classes

```
                 GrfBase<T> (abstract)
                /                    \
               /                      \
        GrfNode                   GrfBrowser
   (fd: number)               (fd: File)
   Node.js fs.read()          FileReader API
```

`GrfBase<T>` contem toda a logica de:
- Parsing de header e file table
- Decriptacao DES
- Descompressao zlib
- Lookup de arquivos (case-insensitive)
- Cache LRU (50 entradas)
- Deteccao de encoding
- Busca e filtragem

As subclasses so implementam `getStreamBuffer()` para ler bytes do
armazenamento (disco no Node.js, File API no browser).

### Buffer Pool

`buffer-pool.ts` implementa um pool de buffers reutilizaveis para reduzir
pressao no Garbage Collector:

- Tamanhos padrao: 1KB, 4KB, 8KB, 16KB, 32KB, 64KB, 128KB, 256KB
- Maximo de 10 buffers por tamanho
- Buffers maiores nao sao poolados
- Singleton exportado como `bufferPool`

### Cache LRU

O `GrfBase` mantem um cache LRU (Least Recently Used) de 50 entradas.
Arquivos ja extraidos sao cacheados para acesso rapido em requisicoes seguintes.

```typescript
// Cache hit
const cached = this.getFromCache(path);
if (cached) return cached;

// Cache miss -> extrair, cachear, retornar
const result = this.decodeEntry(data, entry);
this.addToCache(path, result);
```

---

## 13. API Publica

### Instalacao

```bash
npm install @chicowall/grf-loader
```

### Uso Basico (Node.js)

```typescript
import { openSync } from 'fs';
import { GrfNode } from '@chicowall/grf-loader';

// Abrir GRF
const fd = openSync('data.grf', 'r');
const grf = new GrfNode(fd);
await grf.load();

// Informacoes
console.log(`Versao: 0x${grf.version.toString(16)}`);
console.log(`Arquivos: ${grf.fileCount}`);

// Extrair arquivo
const { data, error } = await grf.getFile('data\\sprite\\npc\\1_f_maria.spr');
if (data) {
  // data e Uint8Array com os bytes do arquivo
}

// Buscar arquivos
const sprites = grf.find({ ext: 'spr', limit: 10 });
const maps = grf.getFilesByExtension('gat');

// Estatisticas
const stats = grf.getStats();
console.log(`Encoding detectado: ${stats.detectedEncoding}`);
console.log(`Extensoes: ${grf.listExtensions().join(', ')}`);
```

### Opcoes

```typescript
const grf = new GrfNode(fd, {
  filenameEncoding: 'auto',          // 'auto' | 'utf-8' | 'cp949' | 'euc-kr' | 'latin1'
  autoDetectThreshold: 0.01,         // Limiar para auto-deteccao (1%)
  maxFileUncompressedBytes: 256*1024*1024,  // Limite por arquivo (256MB)
  maxEntries: 500000,                // Limite de entradas
});
```

### Metodos Principais

| Metodo | Descricao |
|--------|-----------|
| `load()` | Carrega header e file table |
| `getFile(path)` | Extrai arquivo (retorna `{data, error}`) |
| `hasFile(path)` | Verifica se arquivo existe |
| `getEntry(path)` | Metadata sem extrair |
| `resolvePath(path)` | Resolve path case-insensitive |
| `find(options)` | Busca com filtros (ext, contains, regex) |
| `getFilesByExtension(ext)` | Todos os arquivos de uma extensao |
| `listFiles()` | Lista todos os nomes |
| `listExtensions()` | Lista todas as extensoes |
| `getStats()` | Estatisticas (fileCount, badNames, collisions) |
| `getDetectedEncoding()` | Encoding detectado/configurado |
| `reloadWithEncoding(enc)` | Re-parseia com outro encoding |
| `clearCache()` | Limpa cache LRU |

### Tipos Exportados

```typescript
// Entry de arquivo
interface TFileEntry {
  type: number;           // flags (0x01=file, 0x02=mixed, 0x04=header)
  offset: number;         // offset relativo (sem HEADER_SIZE)
  realSize: number;       // tamanho descomprimido
  compressedSize: number; // tamanho comprimido
  lengthAligned: number;  // tamanho alinhado (para DES)
  rawNameBytes?: Uint8Array; // bytes raw do nome
}

// Resultado de busca de path
interface ResolveResult {
  status: 'found' | 'not_found' | 'ambiguous';
  matchedPath?: string;
  candidates?: string[];
}

// Estatisticas
interface GrfStats {
  fileCount: number;
  badNameCount: number;
  collisionCount: number;
  extensionStats: Map<string, number>;
  detectedEncoding: FilenameEncoding;
}

// Opcoes de busca
interface FindOptions {
  ext?: string;
  contains?: string;
  endsWith?: string;
  regex?: RegExp;
  limit?: number;
}
```

### Codigos de Erro

```typescript
const GRF_ERROR_CODES = {
  INVALID_MAGIC:       'GRF_INVALID_MAGIC',        // Assinatura invalida
  UNSUPPORTED_VERSION: 'GRF_UNSUPPORTED_VERSION',   // Versao nao suportada
  NOT_LOADED:          'GRF_NOT_LOADED',             // GRF nao carregado
  FILE_NOT_FOUND:      'GRF_FILE_NOT_FOUND',         // Arquivo nao encontrado
  AMBIGUOUS_PATH:      'GRF_AMBIGUOUS_PATH',         // Path ambiguo
  DECOMPRESS_FAIL:     'GRF_DECOMPRESS_FAIL',        // Falha na descompressao
  CORRUPT_TABLE:       'GRF_CORRUPT_TABLE',          // Tabela corrompida
  LIMIT_EXCEEDED:      'GRF_LIMIT_EXCEEDED',         // Limite excedido
  INVALID_OFFSET:      'GRF_INVALID_OFFSET',         // Offset invalido
  DECRYPT_REQUIRED:    'GRF_DECRYPT_REQUIRED',       // Decriptacao necessaria
};
```

---

## 14. Referencia Cruzada

### Implementacoes de Referencia

| Projeto | Linguagem | URL |
|---------|-----------|-----|
| GRFEditor | C# | Tokeiburu/GRFEditor |
| roBrowser | JavaScript | AntaresProject/roBrowserLegacy |
| OpenKore | Perl | OpenKore/openkore |
| grf-loader | TypeScript | FranciscoWallison/grf-loader |

### Arquivos do grf-loader por Funcionalidade

| Funcionalidade | Arquivo | Linhas-chave |
|----------------|---------|-------------|
| Header parsing | `grf-base.ts` | 221-275 |
| Heuristica 0x300 | `grf-base.ts` | 253-261 |
| File table parsing | `grf-base.ts` | 277-313 |
| File entry parsing | `grf-base.ts` | 356-461 |
| Decriptacao DES | `des.ts` | 176-180 |
| decodeFull (mixed) | `des.ts` | 185-224 |
| decodeHeader (header-only) | `des.ts` | 229-238 |
| Shuffle decode | `des.ts` | 243-255 |
| Shuffle table | `des.ts` | 260-276 |
| Expansion (E) | `des.ts` | 125-137 |
| S-Box substitution | `des.ts` | 143-152 |
| Round function | `des.ts` | 158-171 |
| IP/FP permutation | `des.ts` | 79-104 |
| Transposition (P-Box) | `des.ts` | 109-119 |
| Encoding detection | `decoder.ts` | 301-347 |
| Mojibake fix | `decoder.ts` | 162-228 |
| Buffer pool | `buffer-pool.ts` | 11-123 |
| Node.js I/O | `grf-node.ts` | 15-59 |
| Extracao completa | `grf-base.ts` | 513-566 |
| Cache LRU | `grf-base.ts` | 481-511 |
| Search API | `grf-base.ts` | 624-671 |

### Testes

Os testes cobrem:

- Validacao de file descriptor invalido
- Arquivo corrompido (0 bytes)
- Arquivo nao-GRF
- Versao nao suportada (0x103)
- Load unico (idempotencia)
- Listagem de arquivos
- Rejeicao de `getFile` antes do `load()`
- Arquivo nao encontrado
- Diretorio (nao-arquivo)
- Arquivo corrompido dentro do GRF
- Arquivo sem compressao/encriptacao
- Arquivo com compressao sem encriptacao
- Arquivo com encriptacao parcial (HEADER, flags 0x05)
- Arquivo com encriptacao completa (MIXED, flags 0x03)
- Arquivo grande com encriptacao completa
- Estatisticas
- Listagem e existencia de arquivos
- Metadata de entries
- Resolucao case-insensitive de paths
- Erros tipados (GrfError com codigos)
- Opcao de encoding
- Auto-deteccao de encoding
