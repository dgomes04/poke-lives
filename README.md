# Poke Lives

App para Windows que ajuda a farmar no **[PokeIdle](https://pokeidle.io)**: deixa as lives oficiais da Twitch e da Kick abertas juntando pontos de canal, troca esses pontos pelos bônus do jogo sozinho e roda até 4 contas do PokeIdle num hub só — com troca automática de hunt, alertas e acompanhamento pelo celular.

> Projeto da comunidade, **sem ligação** com o PokeIdle, a Twitch, a Kick ou a Nintendo/The Pokémon Company. Use por sua conta e risco.

## Baixar e instalar

1. Baixe o `Poke Lives Setup x.y.z.exe` na página de **[Releases](../../releases)**.
2. Abra o instalador. O Windows pode mostrar "O Windows protegeu o computador" (o app não tem assinatura paga): clique em **Mais informações → Executar assim mesmo**.
3. O atalho **Poke Lives** aparece na área de trabalho. O app pode iniciar junto com o Windows e fica na bandeja.

Logins (Twitch, Kick, PokeIdle) ficam salvos na sessão de cada site, dentro do app. **Nenhuma senha é guardada pelo app.**

## O que ele faz

### Lives (Twitch e Kick)
- Grade com até 2 lives por plataforma, escolhidas sozinhas entre os streamers oficiais que estão ao vivo — dando prioridade a quem você tem mais pontos.
- Qualidade baixa, chat leve e bloqueio de anúncios para gastar menos memória; pega o baú de bônus da Twitch; aceita o aviso de 18+ da Kick.
- Lê o saldo de pontos de cada canal e recarrega lives travadas.

### Bônus do PokeIdle
- Lê os bônus de live ativos na conta principal e, quando um acaba, resgata o mais barato marcado (XP, Captura, Secret Lure) em qualquer canal com pontos.
- Na Outland pula Secret Lure e Captura (lá eles não rendem nada).

### Hub de contas do PokeIdle
- Até 4 contas lado a lado (grade, 1+3, foco ou **Cards** com os números de cada uma).
- **Troca automática de hunt** pela melhor de XP/h, Ouro/h ou Shiny/h da extensão **/hunt**, esperando o fim do combate e curando o time antes.
- Avisos de **shiny**, de **farm parada** (pokémon morto sem revive/poção) e de **pokebolas acabando**.
- **Compra automática de Ultra Ball** quando ela acaba (Market → Pokebolas → Máx, só com ouro). Pode desligar no menu Boost.
- Itens de cada conta: bolas, revives, poções e o que vende no Mercado, com valor estimado em gemas.
- Resumo do dia (pontos, boosts, hunts, shinies) e histórico filtrável.
- **Comparar** um Pokémon seu com outro (seu ou do Mercado).
- **Snipe** com a extensão Rotom Sniper, por conta.

### Celular
Ative em ⚙ → **Acompanhar pelo celular** e leia o QR code. A página mostra ao vivo as contas, os itens, os shinies, as lives e o histórico, e a tela de cada jogo. O único comando é **Voltar a jogar no PC** (quando você abriu a conta no celular).
- Na mesma rede Wi-Fi funciona direto.
- Fora de casa: instale o **[Tailscale](https://tailscale.com)** no PC e no celular (mesma conta) e use o segundo QR code.
- O link tem um código secreto; **Novo link** invalida o antigo.

## Extensões opcionais

O app lê algumas extensões já instaladas no **Brave, Chrome ou Edge** (não vêm junto):
- **/hunt for PokeIdle** — necessária para a troca automática de hunt.
- **Rotom Sniper** — necessária para o botão Snipe.

## Rodar pelo código

Precisa do [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npm start          # abre o app
npm run dist       # gera o instalador em dist/
```

## Avisos

- A Twitch e a Kick podem não gostar de pontos farmados com várias contas no mesmo IP.
- O PokeIdle permite até 4 contas por pessoa e permite automação (veja os Termos do jogo).
- Automação que compra itens usa só ouro do jogo; nada é comprado com diamante, gema ou dinheiro.

## Licença

[MIT](LICENSE)
