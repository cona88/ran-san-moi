# Monetização — Neon Snake 3D

**Data:** 2026-06-22
**Meta:** $500/mês (luz $150 + condomínio $350)
**Estratégia:** Híbrida — licensing upfront + revenue share recorrente + doações

---

## Contexto

O Neon Snake 3D é um jogo de browser em HTML puro (single file, Three.js + bloom). O visual synthwave/neon é o principal diferencial: a esmagadora maioria dos snakes disponíveis em portais é 2D flat. O jogo já tem mobile support via touch controls.

---

## Abordagem escolhida: Híbrida (3 camadas)

### Camada 1 — Licensing não-exclusivo (caixa rápido)
Vender o direito de hospedar o jogo para portais que pagam upfront. A licença é não-exclusiva — o mesmo jogo pode ser vendido para múltiplos portais.

### Camada 2 — Revenue share em portais premium (recorrente)
Submeter para portais de alto tráfego que pagam % da receita de anúncios. Esses portais levam o próprio tráfego; o jogo apenas precisa cumprir requisitos técnicos.

### Camada 3 — Doações diretas (passivo)
Ko-fi ou Buy Me a Coffee integrado na tela de gameover. Baixo esforço, renda residual.

---

## Preparação técnica do jogo

Todos os itens abaixo são modificações superficiais no `index.html`. Nenhum muda a arquitetura.

| Item | Descrição | Prioridade |
|------|-----------|-----------|
| Tradução para inglês | Substituir todas as strings pt-BR por en-US | Alta |
| Efeitos sonoros | Beep ao comer, crash ao morrer (AudioContext + oscilador) | Alta |
| Pause (tecla P) | Overlay de pausa + gating no loop | Alta |
| GameDistribution SDK | 1 script tag obrigatório para esse portal | Média |
| Ko-fi button | Link discreto na tela de gameover | Baixa |
| Screenshot 1280×720 + GIF gameplay | Material de submissão | Alta |

---

## Portais de Licensing (Camada 1)

Meta: 3–5 acordos no mês 1 → $300–$600 upfront.

| Portal | URL de submissão | Modelo | Estimativa |
|--------|-----------------|--------|-----------|
| Famobi | famobi.com (buscar "submit game") | Licença não-exclusiva | $100–$300 |
| Softgames | softgames.com (buscar "developers") | Licença não-exclusiva | $100–$200 |
| GamePix | gamepix.com (buscar "submit") | Licença ou rev-share | $50–$150 |
| MarketJS | marketjs.com (buscar "developers") | Licença não-exclusiva | $100–$200 |
| GameMonetize | gamemonetize.com | Distribui para 50+ portais | $50–$150 |

**Pitch diferencial:** Three.js 3D com bloom effect — visualmente único no nicho de snake.

---

## Portais de Revenue Share (Camada 2)

Meta: $150–$400/mês a partir do mês 2.

| Portal | URL | Modelo | Potencial mensal | Obs |
|--------|-----|--------|-----------------|-----|
| CrazyGames | crazygames.com/developers | 30% rev-share | $50–$300 | Prioridade 1, não exige exclusividade |
| GameDistribution | gamedistribution.com | Rev-share | $30–$200 | SDK obrigatório |
| Poki | poki.com/developers | Rev-share alto | $100–$500 | Pode pedir exclusividade — submeter após CrazyGames |
| itch.io | itch.io | Pay-what-you-want | $20–$80 | Publicar desde o início |

---

## Projeção de Receita

| Mês | Fonte | Conservador | Otimista |
|-----|-------|-------------|---------|
| 1 | Licenças upfront (3–5 portais) | $300 | $750 |
| 1 | itch.io lançamento | $20 | $80 |
| 2 | Rev-share (CrazyGames + GD) | $80 | $250 |
| 2 | Novas licenças | $100 | $250 |
| 2 | Ko-fi | $15 | $50 |
| **2 total** | | **$195** | **$550** |
| 3 | Rev-share consolidado | $200 | $500 |
| 3 | Licenças residuais + Ko-fi | $50 | $200 |
| **3 total** | | **$250** | **$700** |

**Meta $500/mês:** alcançável entre mês 2 e mês 3 no cenário conservador; mês 1 no otimista.

---

## Cronograma de 30 dias

### Semana 1 — Preparação
- [ ] Traduzir UI para inglês
- [ ] Adicionar sons (AudioContext)
- [ ] Adicionar pause (tecla P)
- [ ] Integrar GameDistribution SDK
- [ ] Gravar screenshot 1280×720 e GIF de gameplay
- [ ] Criar contas: GameDistribution, CrazyGames, Poki, itch.io, Ko-fi

### Semana 2 — Primeiras submissões
- [ ] Submeter para Famobi, Softgames, MarketJS, GamePix, GameMonetize
- [ ] Publicar no itch.io (pay-what-you-want, preço sugerido $2)
- [ ] Submeter para CrazyGames e GameDistribution

### Semana 3 — Tração
- [ ] Follow-up nas submissões pendentes
- [ ] Post no Reddit: r/webgames, r/indiegaming, r/gamedev
- [ ] Adicionar Ko-fi button no gameover

### Semana 4 — Consolidação
- [ ] Processar acordos de licença recebidos e assinar
- [ ] Submeter para Poki (se CrazyGames não exigiu exclusividade)
- [ ] Avaliar RPM dos portais e priorizar onde investir próximos meses

---

## Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Portais rejeitam por falta de áudio | Sons simples via AudioContext — sem biblioteca externa |
| CrazyGames pede exclusividade | Negociar prazo curto (6 meses) ou recusar e ir para Poki |
| Rev-share demora mais que o esperado | Licensing cobre o gap; priorizar portais que pagam upfront |
| Jogo não recebe tráfego orgânico | Post no Reddit + TikTok com gameplay; custo zero |

---

## Métricas de sucesso

- **Mês 1:** ≥ 3 acordos de licença assinados
- **Mês 2:** ≥ $200 em rev-share acumulado
- **Mês 3:** $500/mês recorrente de portais + itch.io + doações
